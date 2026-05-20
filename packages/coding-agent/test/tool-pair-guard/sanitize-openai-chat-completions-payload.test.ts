import { describe, expect, it } from "vitest";
import { sanitizeOpenAIChatCompletionsPayload } from "../../src/core/extensions/builtin/tool-pair-guard/sanitize-openai-chat-completions-payload.ts";

describe("sanitizeOpenAIChatCompletionsPayload", () => {
	it("returns same reference for payload without messages", () => {
		const payload = {};
		expect(sanitizeOpenAIChatCompletionsPayload(payload)).toBe(payload);
	});

	it("returns same reference for non-object payloads", () => {
		expect(sanitizeOpenAIChatCompletionsPayload(null)).toBeNull();
		expect(sanitizeOpenAIChatCompletionsPayload("text")).toBe("text");
		expect(sanitizeOpenAIChatCompletionsPayload(42)).toBe(42);
	});

	it("returns same reference when all tool pairs are valid", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
			],
		};

		expect(sanitizeOpenAIChatCompletionsPayload(payload)).toBe(payload);
	});

	it("removes a single orphan tool message", () => {
		const payload = {
			messages: [{ role: "tool", tool_call_id: "missing", content: "bad" }],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as { messages: unknown[] };

		expect(result).not.toBe(payload);
		expect(result.messages).toHaveLength(0);
	});

	it("removes orphan tool messages and synthesizes missing paired output", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "orphan", content: "bad" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as {
			messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
		};

		expect(result.messages).toHaveLength(2);
		expect(result.messages[0]?.role).toBe("assistant");
		expect(result.messages[1]).toEqual({
			role: "tool",
			tool_call_id: "call-1",
			content: "Tool output unavailable (interrupted before result)",
		});
	});

	it("keeps paired tool message and removes orphan from same conversation", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
				{ role: "tool", tool_call_id: "call-2", content: "orphan" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as { messages: Array<{ role: string }> };

		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]?.role).toBe("tool");
	});

	it("inserts synthetic tool messages for assistant tool calls missing results", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [
						{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } },
						{ id: "call-2", type: "function", function: { name: "ls", arguments: "{}" } },
					],
				},
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as {
			messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
		};

		expect(result.messages).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } },
					{ id: "call-2", type: "function", function: { name: "ls", arguments: "{}" } },
				],
			},
			{ role: "tool", tool_call_id: "call-1", content: "ok" },
			{
				role: "tool",
				tool_call_id: "call-2",
				content: "Tool output unavailable (interrupted before result)",
			},
		]);
	});

	it("inserts synthetic tool messages before the transcript advances", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "user", content: "hello" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as { messages: Array<{ role: string }> };

		expect(result.messages).toEqual([
			{
				role: "assistant",
				content: null,
				tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
			},
			{
				role: "tool",
				tool_call_id: "call-1",
				content: "Tool output unavailable (interrupted before result)",
			},
			{ role: "user", content: "hello" },
		]);
	});

	it("removes duplicate tool messages for the same tool call", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
				{ role: "tool", tool_call_id: "call-1", content: "duplicate" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as {
			messages: Array<{ role: string; content?: string }>;
		};

		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]).toEqual({ role: "tool", tool_call_id: "call-1", content: "ok" });
	});

	it("removes tool messages with missing or empty tool_call_id", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", content: "missing" },
				{ role: "tool", tool_call_id: "", content: "empty" },
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
			],
		};

		const result = sanitizeOpenAIChatCompletionsPayload(payload) as {
			messages: Array<{ role: string; content?: string; tool_call_id?: string }>;
		};

		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]?.role).toBe("tool");
		expect(result.messages[1]?.tool_call_id).toBe("call-1");
	});

	it("returns a new payload and does not mutate input when modified", () => {
		const payload = {
			messages: [
				{
					role: "assistant",
					content: null,
					tool_calls: [{ id: "call-1", type: "function", function: { name: "bash", arguments: "{}" } }],
				},
				{ role: "tool", tool_call_id: "call-1", content: "ok" },
				{ role: "tool", tool_call_id: "orphan", content: "drop" },
			],
		};

		const before = JSON.parse(JSON.stringify(payload)) as typeof payload;
		const result = sanitizeOpenAIChatCompletionsPayload(payload) as typeof payload;

		expect(result).not.toBe(payload);
		expect(payload).toEqual(before);
	});
});
