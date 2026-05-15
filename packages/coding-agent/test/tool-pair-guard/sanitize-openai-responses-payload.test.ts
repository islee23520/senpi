import { describe, expect, it } from "vitest";
import { sanitizeOpenAIResponsesPayload } from "../../src/core/extensions/builtin/tool-pair-guard/sanitize-openai-responses-payload.js";

describe("sanitizeOpenAIResponsesPayload", () => {
	it("returns same reference for payload without responses input", () => {
		const payload = { messages: [] };
		expect(sanitizeOpenAIResponsesPayload(payload)).toBe(payload);
	});

	it("removes orphan function_call_output items", () => {
		const payload = {
			model: "gpt-5.5",
			input: [
				{ role: "user", content: [{ type: "input_text", text: "hello" }] },
				{ type: "function_call_output", call_id: "call_missing", output: "stale" },
			],
		};

		const result = sanitizeOpenAIResponsesPayload(payload) as { input: unknown[] };

		expect(result).not.toBe(payload);
		expect(result.input).toEqual([{ role: "user", content: [{ type: "input_text", text: "hello" }] }]);
		expect(payload.input).toHaveLength(2);
	});

	it("removes orphan custom_tool_call_output items", () => {
		const payload = {
			model: "gpt-5.5",
			input: [{ type: "custom_tool_call_output", call_id: "call_missing", name: "apply_patch", output: "stale" }],
		};

		const result = sanitizeOpenAIResponsesPayload(payload) as { input: unknown[] };

		expect(result.input).toEqual([]);
	});

	it("inserts synthetic outputs for function calls missing results", () => {
		const payload = {
			model: "gpt-5.5",
			input: [{ type: "function_call", call_id: "call_shell", name: "bash", arguments: "{}" }],
		};

		const result = sanitizeOpenAIResponsesPayload(payload) as { input: unknown[] };

		expect(result.input).toEqual([
			{ type: "function_call", call_id: "call_shell", name: "bash", arguments: "{}" },
			{
				type: "function_call_output",
				call_id: "call_shell",
				output: "Tool output unavailable (interrupted before result)",
			},
		]);
	});

	it("inserts synthetic outputs for custom tool calls missing results", () => {
		const payload = {
			model: "gpt-5.5",
			input: [{ type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "*** Begin Patch" }],
		};

		const result = sanitizeOpenAIResponsesPayload(payload) as { input: unknown[] };

		expect(result.input).toEqual([
			{ type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "*** Begin Patch" },
			{
				type: "custom_tool_call_output",
				call_id: "call_patch",
				name: "apply_patch",
				output: "Tool output unavailable (interrupted before result)",
			},
		]);
	});

	it("keeps valid pairs unchanged", () => {
		const payload = {
			model: "gpt-5.5",
			input: [
				{ type: "function_call", call_id: "call_shell", name: "bash", arguments: "{}" },
				{ type: "function_call_output", call_id: "call_shell", output: "ok" },
				{ type: "custom_tool_call", call_id: "call_patch", name: "apply_patch", input: "*** Begin Patch" },
				{ type: "custom_tool_call_output", call_id: "call_patch", name: "apply_patch", output: "ok" },
			],
		};

		expect(sanitizeOpenAIResponsesPayload(payload)).toBe(payload);
	});

	it("does not validate output-only deltas when previous_response_id is present", () => {
		const payload = {
			model: "gpt-5.5",
			previous_response_id: "resp_1",
			input: [{ type: "function_call_output", call_id: "call_from_previous_response", output: "ok" }],
		};

		expect(sanitizeOpenAIResponsesPayload(payload)).toBe(payload);
	});
});
