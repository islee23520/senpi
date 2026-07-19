import { afterEach, describe, expect, it } from "vitest";
import type { MethodRegistry } from "../../src/modes/app-server/rpc/registry.ts";
import type { TurnLog, WireItem } from "../../src/modes/app-server/threads/turn-log.ts";
import {
	cleanupRoots,
	createHarness,
	dataArray,
	objectValue,
	responseResult,
	stringAt,
	writePersistedSession,
} from "./app-server-thread-handlers-harness.ts";

afterEach(async () => {
	await cleanupRoots();
});

describe("app-server thread history retention", () => {
	it("retains full history across same-process unload and resume, with scoped errors and gates", async () => {
		const { connection, registry, root, threads, turnLog } = await createHarness();
		const threadId = "55555555-5555-4555-8555-555555555555";
		await writePersistedSession(root, threadId);
		const entry = await threads.resumeThread(threadId);
		recordTurn(turnLog, entry.id, 1, [
			{ id: "user-1", type: "userMessage", content: [] },
			{ id: "agent-1", type: "agentMessage", text: "answer" },
		]);
		expect(threads.unloadThread(entry.id)).toBe(true);

		const resumed = await registry.dispatch(connection, {
			id: 16,
			method: "thread/resume",
			params: { threadId: entry.id },
		});
		expect(resumed).not.toHaveProperty("error");
		const afterResume = await registry.dispatch(connection, {
			id: 17,
			method: "thread/items/list",
			params: { threadId: entry.id, limit: 100, sortDirection: "asc" },
		});
		expect(itemIds(afterResume)).toEqual(["user-1", "agent-1"]);

		const gateOff = { initialized: true, capabilities: { experimentalApi: false } };
		const gated = await registry.dispatch(gateOff, {
			id: 18,
			method: "thread/turns/list",
			params: { threadId: entry.id },
		});
		expect(gated).toMatchObject({
			id: 18,
			error: { code: -32600, message: expect.stringContaining("experimentalApi") },
		});

		const unknown = await registry.dispatch(connection, {
			id: 19,
			method: "thread/items/list",
			params: { threadId: "missing-thread" },
		});
		expect(unknown).toMatchObject({
			id: 19,
			error: { code: -32600, message: expect.stringContaining("thread not found") },
		});

		const invalidCursor = await registry.dispatch(connection, {
			id: 20,
			method: "thread/turns/list",
			params: { threadId: entry.id, cursor: "not-json" },
		});
		expect(invalidCursor).toMatchObject({ id: 20, error: { code: -32600 } });

		const other = await threads.createThread({ cwd: root });
		const source = await registry.dispatch(connection, {
			id: 21,
			method: "thread/turns/list",
			params: { threadId: entry.id, limit: 1 },
		});
		const foreignCursor = requiredCursorAt(source, "backwardsCursor");
		const scoped = await registry.dispatch(connection, {
			id: 22,
			method: "thread/turns/list",
			params: { threadId: other.id, cursor: foreignCursor },
		});
		expect(scoped).toMatchObject({ id: 22, error: { code: -32600 } });
	});
});

function recordTurn(turnLog: TurnLog, threadId: string, index: number, items: readonly WireItem[]): void {
	const turnId = `turn-${index}`;
	turnLog.recordTurn(threadId, {
		turnId,
		startedAt: `2026-07-02T00:00:0${index}.000Z`,
		status: "completed",
	});
	for (const item of items) turnLog.appendItem(threadId, turnId, item);
}

function itemIds(response: Awaited<ReturnType<MethodRegistry["dispatch"]>>): string[] {
	return dataArray(responseResult(response)).map((item) => stringAt(objectValue(item).item, "id"));
}

function requiredCursorAt(response: Awaited<ReturnType<MethodRegistry["dispatch"]>>, key: string): string {
	const value = responseResult(response)[key];
	if (typeof value !== "string") throw new Error(`Expected ${key} cursor`);
	return value;
}
