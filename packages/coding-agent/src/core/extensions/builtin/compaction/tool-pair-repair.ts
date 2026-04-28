import type { Message, TextContent } from "@mariozechner/pi-ai";

export const TOOL_RESULT_PLACEHOLDER = "Tool output unavailable (context compacted)";

export function repairOrphanedToolResults(messages: Message[]): Message[] {
	const toolCallIds = new Set<string>();
	const toolResultIds = new Set<string>();
	for (const m of messages) {
		if (m.role === "assistant") for (const b of m.content) if (b.type === "toolCall") toolCallIds.add(b.id);
		if (m.role === "toolResult") toolResultIds.add(m.toolCallId);
	}

	const out: Message[] = [];
	const dangling = new Set([...toolCallIds].filter((id) => !toolResultIds.has(id)));

	for (const m of messages) {
		if (m.role === "toolResult") {
			if (!toolCallIds.has(m.toolCallId)) {
				out.push({ ...m, content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }] satisfies TextContent[] });
				continue;
			}
			out.push(m);
			continue;
		}
		out.push(m);
		if (m.role === "assistant") {
			for (const b of m.content) {
				if (b.type !== "toolCall" || !dangling.has(b.id)) continue;
				out.push({
					role: "toolResult",
					toolCallId: b.id,
					toolName: b.name,
					content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
					isError: false,
					timestamp: m.timestamp ? m.timestamp + 1 : Date.now(),
				});
				dangling.delete(b.id);
			}
		}
	}
	return out;
}
