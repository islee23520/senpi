import { expect, it } from "vitest";
import { wrapStreamWithInvokeRecovery } from "../../src/index.ts";
import type { AssistantMessage, AssistantMessageEvent, Tool, ToolCall } from "../../src/types.ts";
import { AssistantMessageEventStream } from "../../src/utils/event-stream.ts";
import { collectEvents, createAssistantMessage, NativeStreamHarness } from "./invoke-recovery-stream-fixtures.ts";

type InvalidNativeKind = "delta-before-start" | "end-before-start";
type RepeatedNativeKind = "repeated-start" | "delta-after-end" | "repeated-end";

function nativeCall(id = "toolu-invalid"): ToolCall {
	return { type: "toolCall", id, name: "NativeInvalid", arguments: { command: "echo invalid" } };
}

function invalidPartial(): AssistantMessage {
	const fillers = Array.from({ length: 7 }, (_, index) => ({
		type: "providerNative" as const,
		subtype: "fixture",
		raw: { index },
	}));
	return createAssistantMessage([...fillers, { ...nativeCall(), partialJson: "" }]);
}

async function collectInvalidBeforeStart(tool: Tool, kind: InvalidNativeKind) {
	const inner = new AssistantMessageEventStream();
	const wrapped = wrapStreamWithInvokeRecovery(inner, [tool]);
	const partial = invalidPartial();
	inner.push({ type: "start", partial: createAssistantMessage([]) });
	if (kind === "delta-before-start") {
		inner.push({ type: "toolcall_delta", contentIndex: 7, delta: "{}", partial });
	} else {
		inner.push({ type: "toolcall_end", contentIndex: 7, toolCall: nativeCall(), partial });
	}
	inner.push({ type: "done", reason: "stop", message: partial });
	const events = await collectEvents(wrapped);
	return { events, result: await wrapped.result() };
}

async function collectRepeatedSequence(tool: Tool, kind: RepeatedNativeKind) {
	const producer = new NativeStreamHarness();
	const wrapped = wrapStreamWithInvokeRecovery(producer.inner, [tool]);
	const finalCall = nativeCall();
	producer.start();
	const contentIndex = producer.startNative({ ...finalCall, arguments: {} });
	if (kind === "repeated-start") {
		producer.inner.push({
			type: "toolcall_start",
			contentIndex,
			partial: structuredClone(producer.partial),
		});
	} else {
		producer.endNative(contentIndex, finalCall);
		if (kind === "delta-after-end") {
			producer.inner.push({
				type: "toolcall_delta",
				contentIndex,
				delta: "{}",
				partial: structuredClone(producer.partial),
			});
		} else {
			producer.inner.push({
				type: "toolcall_end",
				contentIndex,
				toolCall: finalCall,
				partial: structuredClone(producer.partial),
			});
		}
	}
	producer.finish("stop");
	const events = await collectEvents(wrapped);
	return { events, result: await wrapped.result() };
}

function expectInvalidTerminal(events: readonly AssistantMessageEvent[], result: AssistantMessage): void {
	expect(events.filter((event) => event.type === "error")).toHaveLength(1);
	expect(events.filter((event) => event.type === "done")).toEqual([]);
	expect(result.stopReason).toBe("error");
	expect(result.errorMessage).toBe("Invalid native tool call event order");
	expect(result.content.filter((block) => block.type === "toolCall")).toEqual([]);
	expect(result.diagnostics).toEqual([
		{
			type: "text_tool_call_recovery_invalid_native_event",
			timestamp: expect.any(Number),
			details: { protocol: "antml", status: "invalid_native_event_order" },
		},
	]);
	const diagnostic = JSON.stringify(result.diagnostics);
	expect(diagnostic).not.toContain("toolu-invalid");
	expect(diagnostic).not.toContain("echo invalid");
}

export function registerInvokeRecoveryNativeLifecycleCases(tool: Tool): void {
	it("fails closed for native delta or end before start", async () => {
		const outputs = await Promise.all([
			collectInvalidBeforeStart(tool, "delta-before-start"),
			collectInvalidBeforeStart(tool, "end-before-start"),
		]);

		expect(
			outputs.map(({ events, result }) => ({
				terminal: events.find((event) => event.type === "done" || event.type === "error")?.type,
				stopReason: result.stopReason,
			})),
		).toEqual([
			{ terminal: "error", stopReason: "error" },
			{ terminal: "error", stopReason: "error" },
		]);
		for (const { events, result } of outputs) {
			expectInvalidTerminal(events, result);
			expect(events.filter((event) => event.type.startsWith("toolcall_"))).toEqual([]);
		}
	});

	it("fails closed for repeated native starts and post-end events", async () => {
		const repeatedStart = await collectRepeatedSequence(tool, "repeated-start");
		const deltaAfterEnd = await collectRepeatedSequence(tool, "delta-after-end");
		const repeatedEnd = await collectRepeatedSequence(tool, "repeated-end");

		const outputs = [repeatedStart, deltaAfterEnd, repeatedEnd];
		expect(
			outputs.map(({ events, result }) => ({
				terminal: events.find((event) => event.type === "done" || event.type === "error")?.type,
				stopReason: result.stopReason,
			})),
		).toEqual([
			{ terminal: "error", stopReason: "error" },
			{ terminal: "error", stopReason: "error" },
			{ terminal: "error", stopReason: "error" },
		]);
		for (const output of outputs) {
			expectInvalidTerminal(output.events, output.result);
			expect(output.events.filter((event) => event.type === "toolcall_start")).toHaveLength(1);
			expect(output.events.filter((event) => event.type === "toolcall_end")).toHaveLength(
				output === repeatedStart ? 0 : 1,
			);
		}
		expect(deltaAfterEnd.events.filter((event) => event.type === "toolcall_delta")).toEqual([]);
	});
}
