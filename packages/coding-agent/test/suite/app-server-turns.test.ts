import { describe, expect, it } from "vitest";
import { TurnLog } from "../../src/modes/app-server/threads/turn-log.ts";
import {
	createTurnEngine,
	TurnEngineError,
	type TurnEngineNotification,
	type TurnEngineSession,
	type TurnEngineStore,
} from "../../src/modes/app-server/threads/turns.ts";
import { turnStartParams } from "../../src/modes/app-server/turn-adapter.ts";

class ScriptedSession implements TurnEngineSession {
	readonly promptCalls: Array<{ readonly text: string; readonly source: string | undefined }> = [];
	readonly steerCalls: string[] = [];
	abortCalls = 0;
	promptPreflightResult = true;
	promptError: Error | null = null;
	private readonly listeners: Array<(event: { readonly type: "agent_end" }) => void> = [];

	async prompt(
		text: string,
		options?: { readonly source?: string; readonly preflightResult?: (success: boolean) => void },
	): Promise<void> {
		this.promptCalls.push({ text, source: options?.source });
		options?.preflightResult?.(this.promptPreflightResult);
		if (this.promptError) {
			throw this.promptError;
		}
	}

	async steer(text: string): Promise<void> {
		this.steerCalls.push(text);
	}

	async abort(): Promise<void> {
		this.abortCalls += 1;
		this.emitAgentEnd();
	}

	subscribe(listener: (event: { readonly type: "agent_end" }) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	emitAgentEnd(): void {
		for (const listener of [...this.listeners]) {
			listener({ type: "agent_end" });
		}
	}
}

type FakeEntry = {
	readonly id: string;
	readonly session: ScriptedSession;
	activeTurn: { readonly turnId: string; readonly startedAt: string } | null;
	status: "idle" | "active";
	updatedAt: string;
	taskQueue: Promise<void>;
};

class FakeStore implements TurnEngineStore<FakeEntry> {
	private readonly entries = new Map<string, FakeEntry>();

	add(threadId: string, session = new ScriptedSession()): FakeEntry {
		const entry: FakeEntry = {
			id: threadId,
			session,
			activeTurn: null,
			status: "idle",
			updatedAt: "2026-07-02T00:00:00.000Z",
			taskQueue: Promise.resolve(),
		};
		this.entries.set(threadId, entry);
		return entry;
	}

	getLoadedThread(threadId: string): FakeEntry {
		const entry = this.entries.get(threadId);
		if (!entry) {
			throw new Error(`missing thread ${threadId}`);
		}
		return entry;
	}

	runThreadTask<T>(threadId: string, task: () => Promise<T> | T): Promise<T> {
		const entry = this.getLoadedThread(threadId);
		const run = entry.taskQueue.then(task, task);
		entry.taskQueue = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
}

function createHarness(): {
	readonly engine: ReturnType<typeof createTurnEngine<FakeEntry>>;
	readonly store: FakeStore;
	readonly notifications: TurnEngineNotification[];
	readonly turnLog: TurnLog;
} {
	const store = new FakeStore();
	const turnLog = new TurnLog();
	const notifications: TurnEngineNotification[] = [];
	return {
		store,
		notifications,
		turnLog,
		engine: createTurnEngine({
			store,
			turnLog,
			emitToThread: (_threadId, notification) => notifications.push(notification),
			broadcast: (notification) => notifications.push(notification),
		}),
	};
}

describe("app-server turn engine", () => {
	it("emits the happy turn lifecycle in order and completes on agent_end", async () => {
		const { engine, store, notifications } = createHarness();
		const entry = store.add("thread-a");

		const response = await engine.startTurn({
			threadId: "thread-a",
			clientUserMessageId: "client-user-1",
			input: [{ type: "text", text: "hello", text_elements: [] }],
		});

		expect(response.turn.status).toBe("inProgress");
		expect(response.turn.items).toEqual([]);
		expect(entry.activeTurn?.turnId).toBe(response.turn.id);
		expect(entry.status).toBe("active");
		expect(entry.session.promptCalls).toEqual([{ text: "hello", source: "rpc" }]);
		expect(notifications.map((notification) => notification.method)).toEqual([
			"turn/started",
			"item/started",
			"item/completed",
		]);

		entry.session.emitAgentEnd();
		await entry.taskQueue;

		expect(entry.activeTurn).toBeNull();
		expect(entry.status).toBe("idle");
		expect(notifications.map((notification) => notification.method)).toEqual([
			"turn/started",
			"item/started",
			"item/completed",
			"turn/completed",
			"thread/status/changed",
		]);
		expect(notifications[1]?.params).toMatchObject({
			threadId: "thread-a",
			turnId: response.turn.id,
			item: {
				type: "userMessage",
				clientId: "client-user-1",
				content: [{ type: "text", text: "hello", text_elements: [] }],
			},
		});
	});

	it("rejects stale steering without calling the session", async () => {
		const { engine, store } = createHarness();
		const entry = store.add("thread-a");
		const started = await engine.startTurn({ threadId: "thread-a", input: [{ type: "text", text: "hello" }] });

		await expect(
			engine.steerTurn({
				threadId: "thread-a",
				expectedTurnId: "stale-id",
				input: [{ type: "text", text: "steer" }],
			}),
		).rejects.toMatchObject({
			error: {
				code: -32600,
				message: expect.stringContaining(`expected stale-id but active turn is ${started.turn.id}`),
			},
		});
		expect(entry.session.steerCalls).toEqual([]);
		entry.session.emitAgentEnd();
		await entry.taskQueue;
	});

	it("logs successful steering on the active turn without turn/started", async () => {
		const { engine, store, notifications, turnLog } = createHarness();
		const entry = store.add("thread-a");
		const started = await engine.startTurn({
			threadId: "thread-a",
			clientUserMessageId: "client-user-1",
			input: [{ type: "text", text: "hello" }],
		});
		notifications.length = 0;

		await expect(
			engine.steerTurn({
				threadId: "thread-a",
				expectedTurnId: started.turn.id,
				clientUserMessageId: "client-steer-1",
				input: [{ type: "text", text: "steer", text_elements: [] }],
			}),
		).resolves.toEqual({ turnId: started.turn.id });

		expect(entry.session.steerCalls).toEqual(["steer"]);
		expect(notifications.map((notification) => notification.method)).toEqual(["item/started", "item/completed"]);
		expect(notifications[0]?.params).toMatchObject({
			threadId: "thread-a",
			turnId: started.turn.id,
			item: { id: "client-steer-1", clientId: "client-steer-1", type: "userMessage" },
		});
		expect(turnLog.readTurns("thread-a")[0]?.items).toMatchObject([
			{ type: "userMessage", clientId: "client-user-1" },
			{ type: "userMessage", clientId: "client-steer-1" },
		]);
		entry.session.emitAgentEnd();
		await entry.taskQueue;
	});

	it("rejects turn start before acknowledgement when prompt preflight fails", async () => {
		const { engine, store } = createHarness();
		const entry = store.add("thread-a");
		entry.session.promptPreflightResult = false;
		entry.session.promptError = new Error("missing model");

		await expect(
			engine.startTurn({ threadId: "thread-a", input: [{ type: "text", text: "hello" }] }),
		).rejects.toMatchObject({ error: { code: -32603, message: "missing model" } });
		await entry.taskQueue;
		expect(entry.activeTurn).toBeNull();
		expect(entry.status).toBe("idle");
	});

	it("tolerates interrupt after the active turn already ended", async () => {
		const { engine, store } = createHarness();
		const entry = store.add("thread-a");
		const started = await engine.startTurn({ threadId: "thread-a", input: [{ type: "text", text: "hello" }] });
		entry.session.emitAgentEnd();
		await entry.taskQueue;

		await expect(engine.interruptTurn({ threadId: "thread-a", turnId: started.turn.id })).resolves.toEqual({});
		expect(entry.session.abortCalls).toBe(0);
	});

	it("queues a second turn/start behind the active turn", async () => {
		const { engine, store, notifications } = createHarness();
		const entry = store.add("thread-a");
		const first = await engine.startTurn({ threadId: "thread-a", input: [{ type: "text", text: "first" }] });
		const secondPromise = engine.startTurn({ threadId: "thread-a", input: [{ type: "text", text: "second" }] });

		await Promise.resolve();
		expect(entry.session.promptCalls.map((call) => call.text)).toEqual(["first"]);
		expect(notifications.filter((notification) => notification.method === "turn/started")).toHaveLength(1);

		entry.session.emitAgentEnd();
		const second = await secondPromise;
		expect(second.turn.id).not.toBe(first.turn.id);
		expect(entry.session.promptCalls.map((call) => call.text)).toEqual(["first", "second"]);
		expect(notifications.filter((notification) => notification.method === "turn/started")).toHaveLength(2);

		entry.session.emitAgentEnd();
		await entry.taskQueue;
	});

	it("rejects unknown input item types as invalid params", async () => {
		const { engine, store } = createHarness();
		store.add("thread-a");

		await expect(
			engine.startTurn({
				threadId: "thread-a",
				input: [{ type: "skill", name: "nope", path: "/tmp/nope" }],
			}),
		).rejects.toBeInstanceOf(TurnEngineError);
	});

	it("rejects malformed turn/start RPC params before reaching the turn engine", () => {
		// Given: a turn/start request with a non-array input field.
		const action = () =>
			turnStartParams({ id: 1, method: "turn/start", params: { threadId: "thread-a", input: "hello" } });

		// Then: malformed input is reported as a JSON-RPC invalid params error.
		expect(action).toThrow(TurnEngineError);
		expect(action).toThrow("Invalid params: input must be an array");
	});
});
