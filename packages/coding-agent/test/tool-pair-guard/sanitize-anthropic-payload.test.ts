import { describe, expect, it } from "vitest";
import { sanitizeAnthropicPayload } from "../../src/core/extensions/builtin/tool-pair-guard/sanitize-anthropic-payload.ts";

describe("sanitizeAnthropicPayload", () => {
	it("returns same reference for payload without messages", () => {
		const payload = {};
		expect(sanitizeAnthropicPayload(payload)).toBe(payload);
	});

	it("returns same reference for non-object payloads", () => {
		expect(sanitizeAnthropicPayload(null)).toBeNull();
		expect(sanitizeAnthropicPayload("text")).toBe("text");
		expect(sanitizeAnthropicPayload(42)).toBe(42);
	});

	it("returns same reference when all tool pairs are valid", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" }] },
			],
		};

		expect(sanitizeAnthropicPayload(payload)).toBe(payload);
	});

	it("removes a single orphan tool_result block", () => {
		const payload = {
			messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "missing", content: "bad" }] }],
		};

		const result = sanitizeAnthropicPayload(payload) as { messages: Array<{ content: unknown[] }> };

		expect(result).not.toBe(payload);
		expect(result.messages).toHaveLength(0);
	});

	it("drops orphan-only user messages", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "orphan", content: "bad" }] },
			],
		};

		const result = sanitizeAnthropicPayload(payload) as { messages: Array<{ role: string }> };

		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("assistant");
	});

	it("keeps paired tool_result and removes orphan from same user message", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" },
						{ type: "tool_result", tool_use_id: "toolu-2", content: "orphan" },
					],
				},
			],
		};

		const result = sanitizeAnthropicPayload(payload) as {
			messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }>;
		};

		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]?.content).toEqual([{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" }]);
	});

	it("strips multiple consecutive orphan messages", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "bad-1", content: "a" }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "bad-2", content: "b" }] },
				{ role: "user", content: [{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" }] },
			],
		};

		const result = sanitizeAnthropicPayload(payload) as { messages: Array<{ role: string }> };

		expect(result.messages).toHaveLength(2);
		expect(result.messages[1]?.role).toBe("user");
	});

	it("drops tool_result blocks with missing or empty tool_use_id", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{
					role: "user",
					content: [
						{ type: "tool_result", content: "missing" },
						{ type: "tool_result", tool_use_id: "", content: "empty" },
						{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" },
					],
				},
			],
		};

		const result = sanitizeAnthropicPayload(payload) as {
			messages: Array<{ role: string; content: Array<{ type: string; tool_use_id?: string }> }>;
		};

		expect(result.messages[1]?.content).toEqual([{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" }]);
	});

	it("returns a new payload and does not mutate input when modified", () => {
		const payload = {
			messages: [
				{ role: "assistant", content: [{ type: "tool_use", id: "toolu-1", name: "ls", input: {} }] },
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "toolu-1", content: "ok" },
						{ type: "tool_result", tool_use_id: "orphan", content: "drop" },
					],
				},
			],
		};

		const before = JSON.parse(JSON.stringify(payload)) as typeof payload;
		const result = sanitizeAnthropicPayload(payload) as typeof payload;

		expect(result).not.toBe(payload);
		expect(payload).toEqual(before);
	});
});
