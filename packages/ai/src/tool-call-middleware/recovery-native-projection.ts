import type { AssistantMessage, AssistantMessageEventStream, ToolCall } from "../types.ts";
import type { StreamParserEvent } from "./types.ts";

type ContentBlock = AssistantMessage["content"][number];
type ContentRange = { start: number; end: number };

function cloneContentBlock(block: ContentBlock): ContentBlock {
	if (block.type === "toolCall") {
		return { ...block, arguments: { ...block.arguments } };
	}
	return { ...block };
}

function cloneToolCall(toolCall: ToolCall): ToolCall {
	return { ...toolCall, arguments: { ...toolCall.arguments } };
}

/** Maintains source-index order and native/recovered ID ownership for recovery streams. */
export class RecoveryNativeProjection {
	private readonly stream: AssistantMessageEventStream;
	private readonly message: AssistantMessage;
	private readonly rangesByInnerIndex = new Map<number, ContentRange>();
	private readonly reservedIds = new Set<string>();
	private readonly recoveredIds = new Set<string>();
	private readonly recoveredIdByParserIndex = new Map<number, string>();
	private nextRecoveredId = 0;

	constructor(stream: AssistantMessageEventStream, message: AssistantMessage) {
		this.stream = stream;
		this.message = message;
	}

	reserveVisibleIds(source: AssistantMessage): void {
		for (const block of source.content) {
			if (block.type === "toolCall") this.reservedIds.add(block.id);
		}
	}

	synchronizeLower(source: AssistantMessage, contentIndex: number): boolean {
		for (let innerIndex = 0; innerIndex < contentIndex; innerIndex += 1) {
			if (this.rangesByInnerIndex.has(innerIndex)) continue;
			const block = source.content[innerIndex];
			if (!block) continue;
			if (block.type === "toolCall" && this.recoveredIds.has(block.id)) return false;
			const outerIndex = this.message.content.length;
			this.message.content.push(cloneContentBlock(block));
			this.rangesByInnerIndex.set(innerIndex, { start: outerIndex, end: outerIndex + 1 });
		}
		return true;
	}

	startText(innerIndex: number): number {
		const outerIndex = this.message.content.length;
		this.rangesByInnerIndex.set(innerIndex, { start: outerIndex, end: outerIndex });
		return outerIndex;
	}

	extendText(innerIndex: number): void {
		const range = this.rangesByInnerIndex.get(innerIndex);
		if (range) range.end = this.message.content.length;
	}

	projectNativeStart(source: AssistantMessage, innerIndex: number): "projected" | "collision" | "missing" {
		const block = source.content[innerIndex];
		if (block?.type !== "toolCall") return "missing";
		if (this.recoveredIds.has(block.id)) return "collision";
		this.reservedIds.add(block.id);
		const outerIndex = this.message.content.length;
		this.message.content.push(cloneContentBlock(block));
		this.rangesByInnerIndex.set(innerIndex, { start: outerIndex, end: outerIndex + 1 });
		this.stream.push({ type: "toolcall_start", contentIndex: outerIndex, partial: this.message });
		return "projected";
	}

	projectNativeDelta(source: AssistantMessage, innerIndex: number, delta: string): void {
		const outerIndex = this.rangesByInnerIndex.get(innerIndex)?.start;
		const block = source.content[innerIndex];
		if (outerIndex == null || block?.type !== "toolCall") return;
		this.message.content[outerIndex] = cloneContentBlock(block);
		this.stream.push({ type: "toolcall_delta", contentIndex: outerIndex, delta, partial: this.message });
	}

	projectNativeEnd(innerIndex: number, toolCall: ToolCall): void {
		const outerIndex = this.rangesByInnerIndex.get(innerIndex)?.start;
		if (outerIndex == null) return;
		const finalToolCall = cloneToolCall(toolCall);
		this.message.content[outerIndex] = finalToolCall;
		this.stream.push({
			type: "toolcall_end",
			contentIndex: outerIndex,
			toolCall: finalToolCall,
			partial: this.message,
		});
	}

	assignRecoveredIds(events: readonly StreamParserEvent[]): StreamParserEvent[] {
		return events.map((event) => {
			if (event.type === "toolcall_start") {
				const id = this.allocateRecoveredId();
				this.recoveredIdByParserIndex.set(event.index, id);
				return { ...event, id };
			}
			if (event.type === "toolcall_end") {
				const id = this.recoveredIdByParserIndex.get(event.index) ?? event.id;
				this.recoveredIdByParserIndex.delete(event.index);
				return { ...event, id };
			}
			return event;
		});
	}

	private allocateRecoveredId(): string {
		for (;;) {
			const id = `recovered-antml-${this.nextRecoveredId}`;
			this.nextRecoveredId += 1;
			if (this.reservedIds.has(id)) continue;
			this.reservedIds.add(id);
			this.recoveredIds.add(id);
			return id;
		}
	}
}
