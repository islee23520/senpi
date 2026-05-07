import { afterEach, describe, expect, it } from "vitest";
import googleGoogleSearchExtension, {
	addGoogleGoogleSearchToPayload,
	GOOGLE_GOOGLE_SEARCH_SECTION,
	isGoogleGoogleSearchEnabled,
} from "../../src/core/extensions/builtin/google-google-search/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/types.js";

const ENABLE_ENV = "PI_GOOGLE_GOOGLE_SEARCH";

afterEach(() => {
	delete process.env[ENABLE_ENV];
});

describe("google-google-search builtin extension", () => {
	it("is a no-op when api is anthropic-messages", () => {
		const payload = {
			tools: [{ googleSearch: {} }],
		};

		const result = addGoogleGoogleSearchToPayload("anthropic-messages", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is openai-responses", () => {
		const payload = {
			tools: [{ googleSearch: {} }],
		};

		const result = addGoogleGoogleSearchToPayload("openai-responses", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is openai-completions", () => {
		const payload = {
			tools: [{ googleSearch: {} }],
		};

		const result = addGoogleGoogleSearchToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("injects { googleSearch: {} } for google-generative-ai when env is unset", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ googleSearch: {} });
	});

	it("injects { googleSearch: {} } for google-vertex when env is unset", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleGoogleSearchToPayload("google-vertex", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ googleSearch: {} });
	});

	it("injects when env is truthy", () => {
		process.env[ENABLE_ENV] = "1";
		const payload = {
			tools: [],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toEqual([{ googleSearch: {} }]);
	});

	it.each(["0", "false", "no", "off"])("is a no-op when env is falsy (%s)", (value) => {
		process.env[ENABLE_ENV] = value;
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload);
		expect(result).toBe(payload);
	});

	it("preserves caller-supplied { googleSearch: {} } without duplication", () => {
		const payload = {
			tools: [{ googleSearch: {} }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const googleSearchTools = result.tools.filter((tool) => "googleSearch" in tool);
		expect(googleSearchTools).toHaveLength(1);
		expect(googleSearchTools[0]).toEqual({ googleSearch: {} });
	});

	it("preserves caller-supplied googleSearch config without overwriting or duplication", () => {
		const payload = {
			tools: [{ googleSearch: { searchTypes: { webSearch: {} } } }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const googleSearchTools = result.tools.filter((tool) => "googleSearch" in tool);
		expect(googleSearchTools).toHaveLength(1);
		expect(googleSearchTools[0]).toEqual({ googleSearch: { searchTypes: { webSearch: {} } } });
	});

	it("adds separate googleSearch tool when caller only has functionDeclarations", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toHaveLength(2);
		expect(result.tools[0]).toEqual({
			functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }],
		});
		expect(result.tools[1]).toEqual({ googleSearch: {} });
	});

	it("preserves two tool objects when one already has googleSearch", () => {
		const payload = {
			tools: [
				{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] },
				{ googleSearch: {} },
			],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toHaveLength(2);
		expect(result.tools[0]).toEqual({
			functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }],
		});
		expect(result.tools[1]).toEqual({ googleSearch: {} });
	});

	it("injects single googleSearch entry when tools array is empty", () => {
		const payload = {
			tools: [],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toEqual([{ googleSearch: {} }]);
	});

	it("creates tools when payload has no tools field", () => {
		const payload = { model: "gemini-2.5-pro" };

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload) as {
			model: string;
			tools: Array<Record<string, unknown>>;
		};

		expect(result.model).toBe("gemini-2.5-pro");
		expect(result.tools).toEqual([{ googleSearch: {} }]);
	});

	it("returns new payload object when injecting", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload);

		expect(result).not.toBe(payload);
	});

	it("returns original payload reference on api mismatch", () => {
		const payload = { tools: [] };

		const result = addGoogleGoogleSearchToPayload("anthropic-messages", payload);

		expect(result).toBe(payload);
	});

	it("returns original payload reference when disabled", () => {
		process.env[ENABLE_ENV] = "off";
		const payload = { tools: [] };

		const result = addGoogleGoogleSearchToPayload("google-generative-ai", payload);

		expect(result).toBe(payload);
	});
});

describe("isGoogleGoogleSearchEnabled", () => {
	it("returns true when env is unset", () => {
		expect(isGoogleGoogleSearchEnabled()).toBe(true);
	});

	it.each(["1", "true", "yes", "on", "TRUE", "YES", "  on  "])("returns true for truthy value %s", (value) => {
		process.env[ENABLE_ENV] = value;
		expect(isGoogleGoogleSearchEnabled()).toBe(true);
	});

	it.each(["0", "false", "no", "off", "OFF", "  no  "])("returns false for falsy value %s", (value) => {
		process.env[ENABLE_ENV] = value;
		expect(isGoogleGoogleSearchEnabled()).toBe(false);
	});

	it.each(["garbage", "enable", "enabled"])("returns true for unknown value %s", (value) => {
		process.env[ENABLE_ENV] = value;
		expect(isGoogleGoogleSearchEnabled()).toBe(true);
	});
});

describe("google-google-search before_agent_start", () => {
	it("does not append system prompt when explicitly disabled", async () => {
		process.env[ENABLE_ENV] = "off";

		type BeforeAgentStartHandler = (
			event: { systemPrompt: string },
			ctx: { model?: { api?: string } },
		) => Promise<{ systemPrompt: string } | undefined>;

		let beforeAgentStartHandler: BeforeAgentStartHandler | undefined;
		const pi = {
			on(eventName: string, handler: unknown) {
				if (eventName === "before_agent_start") {
					beforeAgentStartHandler = handler as BeforeAgentStartHandler;
				}
			},
		} satisfies Pick<ExtensionAPI, "on">;

		googleGoogleSearchExtension(pi as ExtensionAPI);
		expect(beforeAgentStartHandler).toBeDefined();

		const result = await beforeAgentStartHandler?.(
			{ systemPrompt: "system" },
			{ model: { api: "google-generative-ai" } },
		);

		expect(result).toBeUndefined();
	});
});

describe("GOOGLE_GOOGLE_SEARCH_SECTION content", () => {
	it("is non-empty and mentions Google Search", () => {
		expect(GOOGLE_GOOGLE_SEARCH_SECTION.trim().length).toBeGreaterThan(0);
		expect(GOOGLE_GOOGLE_SEARCH_SECTION).toContain("Google Search");
	});
});
