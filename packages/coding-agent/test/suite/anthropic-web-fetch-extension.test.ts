import { afterEach, describe, expect, it } from "vitest";
import { addAnthropicWebFetchToPayload } from "../../src/core/extensions/builtin/anthropic-web-fetch/index.js";

const MAX_USES_ENV = "PI_ANTHROPIC_WEB_FETCH_MAX_USES";

afterEach(() => {
	delete process.env[MAX_USES_ENV];
});

describe("anthropic-web-fetch builtin extension", () => {
	it("is a no-op when model api is not anthropic-messages", () => {
		const payload = {
			tools: [{ name: "webfetch", description: "function tool" }],
		};

		const result = addAnthropicWebFetchToPayload("openai-responses", payload);

		expect(result).toBe(payload);
	});

	it("injects the native Anthropic web_fetch tool when missing", () => {
		const payload = {
			model: "claude-sonnet-4-5",
			tools: [{ name: "other_tool" }],
		};

		const result = addAnthropicWebFetchToPayload("anthropic-messages", payload) as {
			tools: unknown[];
		};

		expect(result.tools).toContainEqual({
			type: "web_fetch_20260309",
			name: "web_fetch",
		});
	});

	it("preserves caller-supplied native web_fetch version without duplication", () => {
		const payload = {
			tools: [{ type: "web_fetch_20250910", name: "web_fetch" }],
		};

		const result = addAnthropicWebFetchToPayload("anthropic-messages", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webFetchTools = result.tools.filter((tool) => tool.name === "web_fetch");
		expect(webFetchTools).toHaveLength(1);
		expect(webFetchTools[0]).toEqual({ type: "web_fetch_20250910", name: "web_fetch" });
	});

	it("strips function-tool webfetch and replaces it with Anthropic native tool", () => {
		const payload = {
			tools: [{ name: "webfetch", description: "senpi webfetch function" }, { name: "other_tool" }],
		};

		const result = addAnthropicWebFetchToPayload("anthropic-messages", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webFetchFunctionTools = result.tools.filter((tool) => tool.name === "webfetch");
		const webFetchNativeTools = result.tools.filter((tool) => tool.name === "web_fetch");

		expect(webFetchFunctionTools).toHaveLength(0);
		expect(webFetchNativeTools).toHaveLength(1);
		expect(webFetchNativeTools[0]).toEqual({ type: "web_fetch_20260309", name: "web_fetch" });
	});

	it("strips function-tool web_fetch with no type field", () => {
		const payload = {
			tools: [{ name: "web_fetch", description: "alternative function tool" }],
		};

		const result = addAnthropicWebFetchToPayload("anthropic-messages", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webFetchTools = result.tools.filter((tool) => tool.name === "web_fetch");
		expect(webFetchTools).toHaveLength(1);
		expect(webFetchTools[0]).toEqual({ type: "web_fetch_20260309", name: "web_fetch" });
	});

	it("does not strip function-tool webfetch when api is non-anthropic", () => {
		const payload = {
			tools: [{ name: "webfetch", description: "senpi webfetch function" }],
		};

		const result = addAnthropicWebFetchToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("uses env override for max_uses and omits max_uses without env var", () => {
		const payloadWithoutEnv = { tools: [{ name: "other_tool" }] };
		const resultWithoutEnv = addAnthropicWebFetchToPayload("anthropic-messages", payloadWithoutEnv) as {
			tools: Array<Record<string, unknown>>;
		};
		const withoutEnvTool = resultWithoutEnv.tools.find((tool) => tool.name === "web_fetch");

		expect(withoutEnvTool).toEqual({ type: "web_fetch_20260309", name: "web_fetch" });
		expect(withoutEnvTool).not.toHaveProperty("max_uses");

		process.env[MAX_USES_ENV] = "20";
		const payloadWithEnv = { tools: [{ name: "other_tool" }] };
		const resultWithEnv = addAnthropicWebFetchToPayload("anthropic-messages", payloadWithEnv) as {
			tools: Array<Record<string, unknown>>;
		};
		const withEnvTool = resultWithEnv.tools.find((tool) => tool.name === "web_fetch");

		expect(withEnvTool).toEqual({ type: "web_fetch_20260309", name: "web_fetch", max_uses: 20 });
	});
});
