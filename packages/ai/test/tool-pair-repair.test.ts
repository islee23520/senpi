import { describe, expect, it } from "vitest";
import {
	type AssistantMessage,
	type Message,
	repairOrphanedToolResults,
	TOOL_RESULT_PLACEHOLDER,
	type ToolResultMessage,
	type UserMessage,
} from "../src/index.js";

function userMsg(text: string, timestamp: number): UserMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp };
}

function assistantWithCall(id: string, name: string, timestamp: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id, name, arguments: { path: "." } }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "toolUse",
		timestamp,
	};
}

function toolResult(id: string, name: string, timestamp: number, text: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId: id,
		toolName: name,
		content: [{ type: "text", text }],
		isError: false,
		timestamp,
	};
}

describe("repairOrphanedToolResults", () => {
	it("returns identical structure for valid tool pairs", () => {
		const messages: Message[] = [
			userMsg("list files", 1),
			assistantWithCall("call-1", "ls", 2),
			toolResult("call-1", "ls", 3, "done"),
		];

		const result = repairOrphanedToolResults(messages);

		expect(result).toEqual(messages);
	});

	it("replaces orphan tool result content with placeholder", () => {
		const messages: Message[] = [userMsg("run", 1), toolResult("missing", "ls", 2, "real output")];

		const result = repairOrphanedToolResults(messages);

		expect(result).toHaveLength(2);
		expect(result[1]).toMatchObject({
			role: "toolResult",
			toolCallId: "missing",
			content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
		});
	});

	it("inserts synthetic tool result for dangling assistant tool call", () => {
		const messages: Message[] = [userMsg("run", 1), assistantWithCall("call-2", "pwd", 2)];

		const result = repairOrphanedToolResults(messages);

		expect(result).toHaveLength(3);
		expect(result[2]).toMatchObject({
			role: "toolResult",
			toolCallId: "call-2",
			toolName: "pwd",
			content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
			isError: false,
		});
	});

	it("handles mixed orphan tool results and dangling tool calls", () => {
		const messages: Message[] = [
			userMsg("run", 1),
			assistantWithCall("call-3", "ls", 2),
			toolResult("orphan", "cat", 3, "old output"),
		];

		const result = repairOrphanedToolResults(messages);

		expect(result).toHaveLength(4);
		expect(result).toContainEqual(
			expect.objectContaining({
				role: "toolResult",
				toolCallId: "orphan",
				content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
			}),
		);
		expect(result).toContainEqual(
			expect.objectContaining({
				role: "toolResult",
				toolCallId: "call-3",
				toolName: "ls",
				content: [{ type: "text", text: TOOL_RESULT_PLACEHOLDER }],
			}),
		);
	});
});
