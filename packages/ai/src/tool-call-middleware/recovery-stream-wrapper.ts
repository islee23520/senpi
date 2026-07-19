import type { AssistantMessage, AssistantMessageEventStream, Tool, ToolCall } from "../types.ts";
import { appendAssistantMessageDiagnostic } from "../utils/diagnostics.ts";
import { AssistantMessageEventStream as AssistantMessageEventStreamImpl } from "../utils/event-stream.ts";
import { createAntmlInvokeRecoveryStreamParser } from "./protocols/antml/recovery-stream.ts";
import { createRecoveryCodeMask, type RecoveryCodeMaskSegment } from "./recovery-code-mask.ts";
import { StreamMessageProjection } from "./stream-wrapper-shared.ts";
import type { StreamParserEvent } from "./types.ts";

function appendRecoveryDiagnostic(message: AssistantMessage, toolCall: ToolCall): void {
	appendAssistantMessageDiagnostic(message, {
		type: "text_tool_call_recovery",
		timestamp: Date.now(),
		details: {
			protocol: "antml",
			toolName: toolCall.name,
			id: toolCall.id,
			status: toolCall.incomplete === true ? "incomplete" : "complete",
		},
	});
}

export function wrapStreamWithInvokeRecovery(
	innerStream: AssistantMessageEventStream,
	tools: readonly Tool[],
): AssistantMessageEventStream {
	const outerStream = new AssistantMessageEventStreamImpl();
	const parser = createAntmlInvokeRecoveryStreamParser(tools);
	const mask = createRecoveryCodeMask();

	void (async (): Promise<void> => {
		let projection: StreamMessageProjection | null = null;
		let sawToolCall = false;
		let activeInvoke = false;
		let textOpen = false;
		let textBuffer = "";

		const flushText = (): void => {
			if (!projection || textBuffer.length === 0) return;
			projection.projectParserEvents([{ type: "text", text: textBuffer }]);
			textBuffer = "";
		};

		const projectParserEvents = (events: readonly StreamParserEvent[]): void => {
			if (!projection) return;
			for (const event of events) {
				if (event.type === "text") {
					textBuffer += event.text;
					continue;
				}
				flushText();
				const result = projection.projectParserEvents([event]);
				sawToolCall = sawToolCall || result.sawToolCall;
				if (event.type === "toolcall_start") activeInvoke = true;
				if (event.type === "toolcall_end") {
					activeInvoke = false;
					for (const toolCall of result.completedToolCalls) appendRecoveryDiagnostic(projection.message, toolCall);
				}
			}
		};

		const processSegment = (segment: RecoveryCodeMaskSegment): void => {
			if (segment.recoveryBoundary) projectParserEvents(parser.interrupt());
			if (segment.scan) {
				projectParserEvents(parser.feed(segment.text));
			} else {
				textBuffer += segment.text;
			}
		};

		const feedText = (text: string): void => {
			for (let index = 0; index < text.length; index += 1) {
				const character = text.charAt(index);
				const options = activeInvoke ? { activeInvoke: true } : undefined;
				for (const segment of mask.feed(character, options)) processSegment(segment);
			}
			flushText();
		};

		const finishText = (): void => {
			if (!projection || !textOpen) return;
			for (const segment of mask.finish()) processSegment(segment);
			projectParserEvents(parser.finish());
			flushText();
			projection.finishText();
			textOpen = false;
		};

		const finalize = (source: AssistantMessage): AssistantMessage => {
			if (!projection) return source;
			projection.finalizeDanglingToolCalls();
			const message = projection.finalize(source, sawToolCall);
			if (projection.message.diagnostics) message.diagnostics = [...projection.message.diagnostics];
			return message;
		};

		try {
			for await (const event of innerStream) {
				switch (event.type) {
					case "start":
						projection = new StreamMessageProjection(outerStream, event.partial);
						outerStream.push({ type: "start", partial: projection.message });
						break;
					case "text_start":
						if (!projection) break;
						projection.sync(event.partial);
						projection.startText(event.contentIndex);
						textOpen = true;
						break;
					case "text_delta":
						if (!projection) break;
						projection.sync(event.partial);
						feedText(event.delta);
						break;
					case "text_end":
						if (!projection) break;
						projection.sync(event.partial);
						finishText();
						break;
					case "done": {
						projection ??= new StreamMessageProjection(outerStream, event.message);
						finishText();
						const message = finalize(event.message);
						const recovered = sawToolCall || projection.hasFinalizedToolCallContent();
						const reason =
							recovered && (event.reason === "stop" || event.reason === "length") ? "toolUse" : event.reason;
						outerStream.push({ type: "done", reason, message });
						outerStream.end();
						return;
					}
					case "error": {
						if (!projection) {
							outerStream.push(event);
							outerStream.end(event.error);
							return;
						}
						projection.sync(event.error);
						finishText();
						const message = finalize(event.error);
						if (projection.hasFinalizedToolCallContent()) {
							message.stopReason = "toolUse";
							outerStream.push({ type: "done", reason: "toolUse", message });
							outerStream.end(message);
							return;
						}
						outerStream.push({ type: "error", reason: event.reason, error: message });
						outerStream.end(message);
						return;
					}
					case "thinking_start":
					case "thinking_delta":
					case "thinking_end":
					case "toolcall_start":
					case "toolcall_delta":
					case "toolcall_end":
						break;
				}
			}

			const innerMessage = await innerStream.result();
			projection ??= new StreamMessageProjection(outerStream, innerMessage);
			finishText();
			outerStream.end(finalize(innerMessage));
		} catch (error) {
			if (!projection) {
				outerStream.fail(error);
				return;
			}
			finishText();
			const message = finalize(projection.message);
			message.stopReason = "error";
			message.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			outerStream.push({ type: "error", reason: "error", error: message });
			outerStream.end();
		}
	})();

	return outerStream;
}
