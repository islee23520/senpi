import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ActiveTextItem, ProjectedNotification } from "./projection-types.ts";
import type { WireItem } from "./turn-log.ts";

interface MessageItemNotifier {
	readonly itemId: (contentIndex: number) => string;
	readonly started: (item: WireItem) => ProjectedNotification;
	readonly completed: (item: WireItem) => ProjectedNotification;
	readonly notification: (method: string, params: Record<string, unknown>) => ProjectedNotification;
}

export class MessageItemProjector {
	private readonly notifier: MessageItemNotifier;
	private readonly textItems = new Map<number, ActiveTextItem>();
	private readonly reasoningItems = new Map<number, ActiveTextItem>();

	constructor(notifier: MessageItemNotifier) {
		this.notifier = notifier;
	}

	startText(contentIndex: number): ProjectedNotification[] {
		const item = this.createTextItem(contentIndex);
		return [
			this.notifier.started({ type: "agentMessage", id: item.id, text: "", phase: null, memoryCitation: null }),
		];
	}

	deltaText(contentIndex: number, delta: string): ProjectedNotification[] {
		const item = this.textItems.get(contentIndex) ?? this.createTextItem(contentIndex);
		item.text += delta;
		return [this.notifier.notification("item/agentMessage/delta", { itemId: item.id, delta })];
	}

	completeText(contentIndex: number, text: string): ProjectedNotification[] {
		const item = this.textItems.get(contentIndex) ?? this.createTextItem(contentIndex);
		item.text = text;
		item.completed = true;
		return [
			this.notifier.completed({
				type: "agentMessage",
				id: item.id,
				text: item.text,
				phase: null,
				memoryCitation: null,
			}),
		];
	}

	startReasoning(contentIndex: number): ProjectedNotification[] {
		const item = this.createReasoningItem(contentIndex);
		return [this.notifier.started({ type: "reasoning", id: item.id, summary: [], content: [] })];
	}

	deltaReasoning(contentIndex: number, delta: string): ProjectedNotification[] {
		const item = this.reasoningItems.get(contentIndex) ?? this.createReasoningItem(contentIndex);
		item.text += delta;
		return [this.notifier.notification("item/reasoning/textDelta", { itemId: item.id, delta, contentIndex })];
	}

	completeReasoning(contentIndex: number, text: string): ProjectedNotification[] {
		const item = this.reasoningItems.get(contentIndex) ?? this.createReasoningItem(contentIndex);
		item.text = text;
		item.completed = true;
		return [this.notifier.completed({ type: "reasoning", id: item.id, summary: [], content: [item.text] })];
	}

	completeDanglingText(message: AssistantMessage): ProjectedNotification[] {
		return message.content.flatMap((content, contentIndex) => {
			if (content.type === "text" && !this.textItems.get(contentIndex)?.completed) {
				return this.completeText(contentIndex, content.text);
			}
			if (content.type === "thinking" && !this.reasoningItems.get(contentIndex)?.completed) {
				return this.completeReasoning(contentIndex, content.thinking);
			}
			return [];
		});
	}

	closeDanglingItems(): ProjectedNotification[] {
		return [
			...unfinishedTextItems(this.textItems).flatMap(([contentIndex, item]) =>
				this.completeText(contentIndex, item.text),
			),
			...unfinishedTextItems(this.reasoningItems).flatMap(([contentIndex, item]) =>
				this.completeReasoning(contentIndex, item.text),
			),
		];
	}

	private createTextItem(contentIndex: number): ActiveTextItem {
		const item: ActiveTextItem = { id: this.notifier.itemId(contentIndex), text: "", completed: false };
		this.textItems.set(contentIndex, item);
		return item;
	}

	private createReasoningItem(contentIndex: number): ActiveTextItem {
		const item: ActiveTextItem = { id: this.notifier.itemId(contentIndex), text: "", completed: false };
		this.reasoningItems.set(contentIndex, item);
		return item;
	}
}

function unfinishedTextItems(items: Map<number, ActiveTextItem>): Array<[number, ActiveTextItem]> {
	return Array.from(items.entries()).filter((entry) => !entry[1].completed);
}
