import { describe, expect, it } from "vitest";
import { addOpenAiWebSearchToPayload } from "../../src/core/extensions/builtin/openai-web-search/index.js";

describe("openai-web-search builtin extension", () => {
	it("is a no-op when model api is openai-completions", () => {
		const payload = {
			tools: [{ name: "web_search", description: "function tool" }],
		};

		const result = addOpenAiWebSearchToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when model api is anthropic-messages", () => {
		const payload = {
			tools: [{ name: "web_search", description: "function tool" }],
		};

		const result = addOpenAiWebSearchToPayload("anthropic-messages", payload);

		expect(result).toBe(payload);
	});

	it("injects native web_search when on openai-responses and none exists", () => {
		const payload = {
			tools: [{ name: "other_tool" }],
		};

		const result = addOpenAiWebSearchToPayload("openai-responses", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ type: "web_search" });
	});

	it("injects native web_search when on azure-openai-responses and none exists", () => {
		const payload = {
			tools: [{ name: "other_tool" }],
		};

		const result = addOpenAiWebSearchToPayload("azure-openai-responses", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ type: "web_search" });
	});

	it("preserves caller-supplied web_search_preview and does not duplicate", () => {
		const payload = {
			tools: [{ type: "web_search_preview" }, { name: "other_tool" }],
		};

		const result = addOpenAiWebSearchToPayload("openai-responses", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const webSearchTools = result.tools.filter(
			(tool) => tool.type === "web_search" || tool.type === "web_search_preview",
		);
		expect(webSearchTools).toHaveLength(1);
		expect(webSearchTools[0]).toEqual({ type: "web_search_preview" });
	});

	it("strips function-tool web_search and replaces it with native on openai-responses", () => {
		const payload = {
			tools: [{ name: "web_search", description: "pi-websearch function" }, { name: "other_tool" }],
		};

		const result = addOpenAiWebSearchToPayload("openai-responses", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).not.toContainEqual({ name: "web_search", description: "pi-websearch function" });
		expect(result.tools).toContainEqual({ type: "web_search" });
	});

	it("does not strip function-tool web_search when api is not Responses", () => {
		const payload = {
			tools: [{ name: "web_search", description: "pi-websearch function" }],
		};

		const result = addOpenAiWebSearchToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});
});
