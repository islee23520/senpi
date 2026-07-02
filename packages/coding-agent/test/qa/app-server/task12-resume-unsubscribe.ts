import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, type RegistryConnection } from "../../../src/modes/app-server/rpc/registry.ts";
import {
	NotificationRouter,
	type RoutableConnection,
	type RouterNotification,
} from "../../../src/modes/app-server/server/notifications.ts";
import { registerThreadLifecycleHandlers } from "../../../src/modes/app-server/threads/handlers.ts";
import { ThreadRegistry } from "../../../src/modes/app-server/threads/registry.ts";
import { TurnLog } from "../../../src/modes/app-server/threads/turn-log.ts";

class FakeConnection implements RoutableConnection, RegistryConnection {
	readonly id = "qa-conn";
	readonly transport = "ws";
	readonly capabilities = { experimentalApi: true };
	readonly received: RouterNotification[] = [];
	initialized = true;
	optOutNotificationMethods: readonly string[] | null = null;

	send(notification: RouterNotification): void {
		this.received.push(notification);
	}
}

const scratchRoot = join(tmpdir(), `senpi-qa-task12-resume-unsubscribe-${process.pid}`);

async function main(): Promise<void> {
	rmSync(scratchRoot, { recursive: true, force: true });
	let runError: unknown;
	try {
		const connection = new FakeConnection();
		const threads = new ThreadRegistry({
			agentDir: join(scratchRoot, "agent"),
			sessionDir: join(scratchRoot, "sessions"),
		});
		const notifications = new NotificationRouter({ connections: [connection] });
		const registry = createRegistry();
		registerThreadLifecycleHandlers(registry, {
			threads,
			turnLog: new TurnLog(),
			notifications,
			idleUnloadMinutes: 10,
		});

		const started = await registry.dispatch(connection, {
			id: 1,
			method: "thread/start",
			params: { cwd: scratchRoot },
		});
		const threadId = readThreadId(started);
		const entry = threads.getLoadedThread(threadId);
		if (!entry.subscribers.has(connection.id)) {
			throw new Error("thread/start did not subscribe the requester");
		}

		await expectResult(
			registry.dispatch(connection, {
				id: 2,
				method: "thread/unsubscribe",
				params: { threadId },
			}),
			"unsubscribed",
		);
		await expectResult(
			registry.dispatch(connection, {
				id: 3,
				method: "thread/unsubscribe",
				params: { threadId },
			}),
			"notSubscribed",
		);

		notifications.toThread(threadId, {
			method: "turn/completed",
			params: { threadId, turn: { id: "turn-qa" } },
		});
		connection.received.length = 0;
		const resumed = await registry.dispatch(connection, {
			id: 4,
			method: "thread/resume",
			params: { threadId },
		});
		if ("error" in resumed) {
			throw new Error(resumed.error.message);
		}
		const methods = connection.received.map((notification) => notification.method).join(",");
		if (methods !== "turn/completed") {
			throw new Error(`queued terminal notification did not flush: ${methods || "NONE"}`);
		}

		console.log(`THREAD_ID=${threadId}`);
		console.log("UNSUBSCRIBE=unsubscribed,notSubscribed");
		console.log(`RESUME_FLUSH=${methods}`);
	} catch (error) {
		runError = error;
	}
	rmSync(scratchRoot, { recursive: true, force: true });
	if (existsSync(scratchRoot)) {
		throw new Error(`cleanup failed: ${scratchRoot}`);
	}
	console.log(`CLEANUP=removed:${scratchRoot}`);
	if (runError) {
		throw runError;
	}
}

async function expectResult(
	promise: Promise<Awaited<ReturnType<ReturnType<typeof createRegistry>["dispatch"]>>>,
	expected: string,
): Promise<void> {
	const response = await promise;
	if ("error" in response) {
		throw new Error(response.error.message);
	}
	const result = objectValue(response.result);
	if (result.status !== expected) {
		throw new Error(`expected ${expected}, got ${String(result.status)}`);
	}
}

function readThreadId(response: Awaited<ReturnType<ReturnType<typeof createRegistry>["dispatch"]>>): string {
	if ("error" in response) {
		throw new Error(response.error.message);
	}
	const result = objectValue(response.result);
	const thread = objectValue(result.thread);
	const id = thread.id;
	if (typeof id !== "string") {
		throw new Error("thread id missing from response");
	}
	return id;
}

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected object");
	}
	return Object.fromEntries(Object.entries(value));
}

await main();
