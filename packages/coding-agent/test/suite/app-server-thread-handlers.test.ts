import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createRegistry,
	type MethodRegistry,
	type RegistryConnection,
} from "../../src/modes/app-server/rpc/registry.ts";
import {
	NotificationRouter,
	type RoutableConnection,
	type RouterNotification,
} from "../../src/modes/app-server/server/notifications.ts";
import { registerThreadLifecycleHandlers } from "../../src/modes/app-server/threads/handlers.ts";
import { ThreadRegistry } from "../../src/modes/app-server/threads/registry.ts";
import { TurnLog } from "../../src/modes/app-server/threads/turn-log.ts";

const roots: string[] = [];

class FakeConnection implements RoutableConnection, RegistryConnection {
	readonly id = "conn-1";
	readonly transport = "ws";
	readonly received: RouterNotification[] = [];
	readonly capabilities = { experimentalApi: true };
	initialized = true;
	optOutNotificationMethods: readonly string[] | null = null;

	send(notification: RouterNotification): void {
		this.received.push(notification);
	}
}

async function scratchRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "senpi-app-server-thread-handlers-"));
	roots.push(root);
	return root;
}

async function createHarness(): Promise<{
	readonly connection: FakeConnection;
	readonly registry: MethodRegistry;
	readonly root: string;
	readonly threads: ThreadRegistry;
	readonly turnLog: TurnLog;
}> {
	const root = await scratchRoot();
	const connection = new FakeConnection();
	const threads = new ThreadRegistry({
		agentDir: join(root, "agent"),
		sessionDir: join(root, "sessions"),
	});
	const notifications = new NotificationRouter({ connections: [connection] });
	const registry = createRegistry();
	const turnLog = new TurnLog();
	registerThreadLifecycleHandlers(registry, {
		threads,
		turnLog,
		notifications,
		idleUnloadMinutes: 5,
	});
	return { connection, registry, root, threads, turnLog };
}

describe("app-server thread lifecycle handlers", () => {
	afterEach(async () => {
		vi.useRealTimers();
		while (roots.length > 0) {
			await rm(roots.pop()!, { recursive: true, force: true });
		}
	});

	it("returns generated Thread-shaped start responses and subscribes the requesting connection", async () => {
		// Given: a registered lifecycle handler set and an initialized app-server connection.
		const { connection, registry, root, threads } = await createHarness();

		// When: the connection starts a thread.
		const response = await registry.dispatch(connection, {
			id: 1,
			method: "thread/start",
			params: { cwd: root },
		});

		// Then: the response has the generated Thread-required fields and the connection is subscribed.
		expect(response).not.toHaveProperty("error");
		expect(response).toMatchObject({
			id: 1,
			result: {
				serviceTier: null,
				cwd: root,
				runtimeWorkspaceRoots: [root],
				instructionSources: [],
				approvalPolicy: "never",
				approvalsReviewer: "user",
				sandbox: { type: "dangerFullAccess" },
				activePermissionProfile: null,
				multiAgentMode: "explicitRequestOnly",
				thread: {
					preview: "",
					ephemeral: false,
					forkedFromId: null,
					parentThreadId: null,
					status: { type: "idle" },
					cwd: root,
					source: "appServer",
					threadSource: null,
					agentNickname: null,
					agentRole: null,
					gitInfo: null,
					name: null,
					turns: [],
				},
			},
		});
		const result = responseResult(response);
		expect(typeof result.modelProvider).toBe("string");
		expect(typeof result.reasoningEffort).toBe("string");
		const thread = objectAt(result, "thread");
		expect(typeof thread.path === "string" || thread.path === null).toBe(true);
		const threadId = stringAt(thread, "id");
		expect(threads.getLoadedThread(threadId).subscribers.has(connection.id)).toBe(true);
	});

	it("returns the exact unknown rollout text when resuming a missing thread", async () => {
		// Given: no registry entry or disk session for the requested thread id.
		const { connection, registry } = await createHarness();

		// When: the connection resumes an unknown thread.
		const response = await registry.dispatch(connection, {
			id: 2,
			method: "thread/resume",
			params: { threadId: "missing-thread" },
		});

		// Then: the JSON-RPC error text matches the Codex app contract exactly.
		expect(response).toEqual({
			id: 2,
			error: { code: -32603, message: "no rollout found for thread id missing-thread" },
		});
	});

	it("subscribes warm resume and flushes queued terminal notifications", async () => {
		// Given: a warm loaded thread with a terminal notification queued while nobody is subscribed.
		const { connection, root, threads } = await createHarness();
		const entry = await threads.createThread({ cwd: root });
		const notifications = new NotificationRouter({ connections: [connection], threads: [entry] });
		const handlerRegistry = createRegistry();
		registerThreadLifecycleHandlers(handlerRegistry, {
			threads,
			turnLog: new TurnLog(),
			notifications,
			idleUnloadMinutes: 5,
		});
		notifications.toThread(entry.id, {
			method: "turn/completed",
			params: { threadId: entry.id, turn: { id: "turn-1" } },
		});

		// When: the connection resumes that warm thread.
		const response = await handlerRegistry.dispatch(connection, {
			id: 3,
			method: "thread/resume",
			params: { threadId: entry.id },
		});

		// Then: the queued terminal notification flushes to the connection before live use continues.
		expect(response).not.toHaveProperty("error");
		expect(connection.received.map((notification) => notification.method)).toEqual(["turn/completed"]);
		expect(entry.queuedTerminalNotifications).toEqual([]);
		expect(entry.subscribers.has(connection.id)).toBe(true);
	});

	it("reports unsubscribe as unsubscribed, notSubscribed, and notLoaded", async () => {
		// Given: a connection subscribed by thread/start.
		const { connection, registry, root } = await createHarness();
		const started = await registry.dispatch(connection, { id: 4, method: "thread/start", params: { cwd: root } });
		const threadId = stringAt(objectAt(responseResult(started), "thread"), "id");

		// When/Then: unsubscribe reports every stable state.
		await expect(
			registry.dispatch(connection, { id: 5, method: "thread/unsubscribe", params: { threadId } }),
		).resolves.toEqual({ id: 5, result: { status: "unsubscribed" } });
		await expect(
			registry.dispatch(connection, { id: 6, method: "thread/unsubscribe", params: { threadId } }),
		).resolves.toEqual({ id: 6, result: { status: "notSubscribed" } });
		await expect(
			registry.dispatch(connection, { id: 7, method: "thread/unsubscribe", params: { threadId: "missing-thread" } }),
		).resolves.toEqual({ id: 7, result: { status: "notLoaded" } });
	});

	it("serves thread/read from the shared turn log without subscribing", async () => {
		// Given: a loaded thread with a recorded turn and no subscribers.
		const { connection, registry, root, threads, turnLog } = await createHarness();
		const entry = await threads.createThread({ cwd: root });
		turnLog.recordTurn(entry.id, {
			turnId: "turn-1",
			startedAt: "2026-07-02T00:00:00.000Z",
			status: "completed",
		});
		turnLog.appendItem(entry.id, "turn-1", { id: "item-1", type: "userMessage", content: [] });

		// When: the connection reads the thread with turns included.
		const response = await registry.dispatch(connection, {
			id: 8,
			method: "thread/read",
			params: { threadId: entry.id, includeTurns: true },
		});

		// Then: turns come from the shared log and the connection remains unsubscribed.
		expect(response).not.toHaveProperty("error");
		expect(response).toMatchObject({
			id: 8,
			result: {
				thread: {
					id: entry.id,
					turns: [
						{
							id: "turn-1",
							itemsView: "full",
							status: "completed",
							error: null,
							startedAt: 1782950400,
							completedAt: null,
							durationMs: null,
						},
					],
				},
			},
		});
		expect(threads.getLoadedThread(entry.id).subscribers.has(connection.id)).toBe(false);
	});

	it("unloads idle threads after the configured no-subscriber delay", async () => {
		vi.useFakeTimers();
		// Given: a started thread becomes idle with no subscribers.
		const { connection, registry, root } = await createHarness();
		const started = await registry.dispatch(connection, { id: 9, method: "thread/start", params: { cwd: root } });
		const threadId = stringAt(objectAt(responseResult(started), "thread"), "id");
		await registry.dispatch(connection, { id: 10, method: "thread/unsubscribe", params: { threadId } });
		connection.received.length = 0;

		// When: the idle-unload timer elapses.
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

		// Then: lifecycle notifications announce closure and notLoaded status.
		expect(connection.received).toEqual([
			{ method: "thread/closed", params: { threadId } },
			{ method: "thread/status/changed", params: { threadId, status: { type: "notLoaded" } } },
		]);
	});
});

function responseResult(response: Awaited<ReturnType<MethodRegistry["dispatch"]>>): Record<string, unknown> {
	if ("error" in response) {
		throw new Error(response.error.message);
	}
	return objectValue(response.result);
}

function objectAt(value: unknown, key: string): Record<string, unknown> {
	const object = objectValue(value);
	return objectValue(object[key]);
}

function stringAt(value: unknown, key: string): string {
	const object = objectValue(value);
	const child = object[key];
	if (typeof child !== "string") {
		throw new Error(`Expected ${key} to be a string`);
	}
	return child;
}

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Expected an object");
	}
	return Object.fromEntries(Object.entries(value));
}
