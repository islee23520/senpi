import { afterEach, describe, expect, it } from "vitest";
import {
	ANTHROPIC_WEB_SEARCH_SECTION,
	addAnthropicWebSearchToPayload,
} from "../../src/core/extensions/builtin/anthropic-web-search/index.js";

const MAX_USES_ENV = "PI_ANTHROPIC_WEB_SEARCH_MAX_USES";

afterEach(() => {
	delete process.env[MAX_USES_ENV];
});

describe("anthropic-web-search builtin extension", () => {
	it("is a no-op when model api is not anthropic-messages", () => {
		const payload = {
			tools: [{ name: "web_search", description: "function tool" }],
		};

		const result = addAnthropicWebSearchToPayload("openai-responses", payload);

		expect(result).toBe(payload);
	});

	it("injects the native Anthropic web_search tool with default max_uses", () => {
		const payload = {
			model: "claude-sonnet-4-5",
			tools: [{ name: "other_tool" }],
		};

		const result = addAnthropicWebSearchToPayload("anthropic-messages", payload) as {
			tools: unknown[];
		};

		expect(result.tools).toContainEqual({
			type: "web_search_20250305",
			name: "web_search",
			max_uses: 5,
		});
	});

	it("preserves caller-supplied native web_search version without duplication", () => {
		const payload = {
			tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
		};

		const result = addAnthropicWebSearchToPayload("anthropic-messages", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webSearchTools = result.tools.filter((tool) => tool.name === "web_search");
		expect(webSearchTools).toHaveLength(1);
		expect(webSearchTools[0]).toEqual({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
	});

	it("replaces function-tool web_search with Anthropic native tool", () => {
		const payload = {
			tools: [{ name: "web_search", description: "pi-websearch function" }, { name: "other_tool" }],
		};

		const result = addAnthropicWebSearchToPayload("anthropic-messages", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webSearchTools = result.tools.filter((tool) => tool.name === "web_search");
		expect(webSearchTools).toHaveLength(1);
		expect(webSearchTools[0]).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
	});

	it("does not strip function-tool web_search when api is non-anthropic", () => {
		const payload = {
			tools: [{ name: "web_search", description: "pi-websearch function" }],
		};

		const result = addAnthropicWebSearchToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("uses env override for max_uses", () => {
		process.env[MAX_USES_ENV] = "10";
		const payload = {
			tools: [{ name: "other_tool" }],
		};

		const result = addAnthropicWebSearchToPayload("anthropic-messages", payload) as {
			tools: unknown[];
		};

		expect(result.tools).toContainEqual({
			type: "web_search_20250305",
			name: "web_search",
			max_uses: 10,
		});
	});
});

describe("ANTHROPIC_WEB_SEARCH_SECTION content", () => {
	it("mentions web_search availability", () => {
		expect(ANTHROPIC_WEB_SEARCH_SECTION).toContain("web_search");
	});
});
