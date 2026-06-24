import { describe, expect, it } from "vitest";
import {
	createAppServerOverloadError,
	createStreamBackpressureController,
	type StreamBackpressureEvent,
	type StreamBackpressureOutput,
} from "../../src/core/extensions/builtin/pi-codex-app-server/stream-backpressure.ts";

function event(method: string, sequence: number, streamClass: "lossless" | "best-effort"): StreamBackpressureEvent {
	return {
		kind: "semantic",
		method,
		sequence,
		channel: streamClass === "lossless" ? "text" : "command",
		semanticType: streamClass === "lossless" ? "delta" : "progress",
		streamClass,
		externalSessionId: "external-session-1",
		appThreadId: "app-thread-1",
		appTurnId: "app-turn-1",
		appItemId: "app-item-1",
		delta: "chunk",
		index: undefined,
		completedItem: undefined,
		originalParams: {},
	};
}

describe("pi-codex-app-server stream backpressure", () => {
	it("keeps lossless events and emits a lag marker before the next lossless event after best-effort drops", () => {
		const controller = createStreamBackpressureController({
			connectionId: "connection-1",
			bestEffortQueueLimit: 1,
		});

		controller.enqueue(event("item/agentMessage/delta", 1, "lossless"));
		controller.enqueue(event("item/commandExecution/outputDelta", 2, "best-effort"));
		controller.enqueue(event("process/outputDelta", 3, "best-effort"));
		controller.enqueue(event("item/completed", 4, "lossless"));
		const drained = controller.drainAll();

		expect(drained.map((entry) => entry.method)).toEqual([
			"item/agentMessage/delta",
			"item/commandExecution/outputDelta",
			"lag",
			"item/completed",
		]);
		expect(drained.map(readOutputSequence)).toEqual([1, 2, 3, 4]);
		expect(drained[2]).toMatchObject({
			kind: "lag",
			method: "lag",
			connectionId: "connection-1",
			droppedProgressEvents: 1,
			nextLosslessSequence: 4,
		});
		expect(controller.stats()).toMatchObject({
			droppedProgressEvents: 1,
			emittedLagMarkers: 1,
			queuedEvents: 0,
		});
	});

	it("flushes queued best-effort progress before a terminal turn without dropping lossless events", () => {
		const controller = createStreamBackpressureController({
			connectionId: "connection-1",
			bestEffortQueueLimit: 4,
		});

		controller.enqueue(event("item/commandExecution/outputDelta", 1, "best-effort"));
		controller.enqueue(event("item/agentMessage/delta", 2, "lossless"));
		controller.enqueue(event("turn/completed", 3, "lossless"));

		expect(controller.flushTerminal().map((entry) => entry.method)).toEqual([
			"item/commandExecution/outputDelta",
			"item/agentMessage/delta",
			"turn/completed",
		]);
	});

	it("preserves retryable app-server overload as JSON-RPC -32001", () => {
		expect(createAppServerOverloadError({ retryAfterMs: 250 })).toEqual({
			code: -32001,
			message: "app-server overloaded",
			data: { retryable: true, retryAfterMs: 250 },
		});
	});
});

function readOutputSequence(event: StreamBackpressureOutput): number {
	if (event.kind === "semantic" || event.kind === "lag") return event.sequence;
	return event.envelope.sequence;
}
