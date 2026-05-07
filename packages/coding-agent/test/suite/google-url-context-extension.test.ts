import { afterEach, describe, expect, it } from "vitest";
import googleUrlContextExtension, {
	addGoogleUrlContextToPayload,
	GOOGLE_URL_CONTEXT_SECTION,
	isGoogleUrlContextEnabled,
} from "../../src/core/extensions/builtin/google-url-context/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/types.js";

const ENABLE_ENV = "PI_GOOGLE_URL_CONTEXT";

afterEach(() => {
	delete process.env[ENABLE_ENV];
});

describe("google-url-context builtin extension", () => {
	it("is a no-op when api is anthropic-messages", () => {
		const payload = {
			tools: [{ urlContext: {} }],
		};

		const result = addGoogleUrlContextToPayload("anthropic-messages", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is openai-responses", () => {
		const payload = {
			tools: [{ urlContext: {} }],
		};

		const result = addGoogleUrlContextToPayload("openai-responses", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is openai-completions", () => {
		const payload = {
			tools: [{ urlContext: {} }],
		};

		const result = addGoogleUrlContextToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("injects { urlContext: {} } for google-generative-ai when env is unset", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ urlContext: {} });
	});

	it("injects { urlContext: {} } for google-vertex when env is unset", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleUrlContextToPayload("google-vertex", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toContainEqual({ urlContext: {} });
	});

	it("injects when env is truthy", () => {
		process.env[ENABLE_ENV] = "1";
		const payload = {
			tools: [],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toEqual([{ urlContext: {} }]);
	});

	it.each(["0", "false", "no", "off"])("is a no-op when env is falsy (%s)", (value) => {
		process.env[ENABLE_ENV] = value;
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload);
		expect(result).toBe(payload);
	});

	it("preserves caller-supplied { urlContext: {} } without duplication", () => {
		const payload = {
			tools: [{ urlContext: {} }],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const urlContextTools = result.tools.filter((tool) => "urlContext" in tool);
		expect(urlContextTools).toHaveLength(1);
		expect(urlContextTools[0]).toEqual({ urlContext: {} });
	});

	it("preserves caller-supplied urlContext config without overwriting or duplication", () => {
		const payload = {
			tools: [{ urlContext: { includeSnippets: true } }],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		const urlContextTools = result.tools.filter((tool) => "urlContext" in tool);
		expect(urlContextTools).toHaveLength(1);
		expect(urlContextTools[0]).toEqual({ urlContext: { includeSnippets: true } });
	});

	it("adds separate urlContext tool when caller only has functionDeclarations", () => {
		const payload = {
			tools: [{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] }],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toHaveLength(2);
		expect(result.tools[0]).toEqual({
			functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }],
		});
		expect(result.tools[1]).toEqual({ urlContext: {} });
	});

	it("preserves two tool objects when one already has urlContext", () => {
		const payload = {
			tools: [
				{ functionDeclarations: [{ name: "lookup", description: "fn", parameters: { type: "object" } }] },
				{ urlContext: {} },
			],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toHaveLength(2);
		expect(result.tools).toEqual(payload.tools);
	});

	it("injects single entry when tools array is empty", () => {
		const payload = {
			tools: [],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toEqual([{ urlContext: {} }]);
	});

	it("creates tools with urlContext entry when payload has no tools field", () => {
		const payload = {
			contents: [],
		};

		const result = addGoogleUrlContextToPayload("google-generative-ai", payload) as {
			tools: Array<Record<string, unknown>>;
			contents: unknown[];
		};

		expect(result.contents).toEqual([]);
		expect(result.tools).toEqual([{ urlContext: {} }]);
	});

	it("returns a new payload object when injection occurs and original reference when no-op", () => {
		const injectPayload = {
			tools: [],
		};
		const injected = addGoogleUrlContextToPayload("google-generative-ai", injectPayload);
		expect(injected).not.toBe(injectPayload);

		process.env[ENABLE_ENV] = "off";
		const noopPayload = {
			tools: [],
		};
		const noopResult = addGoogleUrlContextToPayload("google-generative-ai", noopPayload);
		expect(noopResult).toBe(noopPayload);
	});

	it("isGoogleUrlContextEnabled returns true when env unset", () => {
		expect(isGoogleUrlContextEnabled()).toBe(true);
	});

	it.each(["1", "true", "yes", "on"])("isGoogleUrlContextEnabled returns true for truthy value (%s)", (value) => {
		process.env[ENABLE_ENV] = value;
		expect(isGoogleUrlContextEnabled()).toBe(true);
	});

	it.each(["0", "false", "no", "off"])("isGoogleUrlContextEnabled returns false for falsy value (%s)", (value) => {
		process.env[ENABLE_ENV] = value;
		expect(isGoogleUrlContextEnabled()).toBe(false);
	});

	it("unknown env values fall back to default-on behavior", () => {
		process.env[ENABLE_ENV] = "maybe";
		expect(isGoogleUrlContextEnabled()).toBe(true);
	});

	it("GOOGLE_URL_CONTEXT_SECTION is non-empty and mentions URL context", () => {
		expect(GOOGLE_URL_CONTEXT_SECTION.trim().length).toBeGreaterThan(0);
		expect(GOOGLE_URL_CONTEXT_SECTION).toContain("URL Context");
		expect(GOOGLE_URL_CONTEXT_SECTION).toContain("url_context");
	});

	it("registers provider-request and agent-start hooks", async () => {
		const hooks: Array<{ event: string; handler: (...args: unknown[]) => unknown }> = [];
		const pi = {
			on: (event: string, handler: (...args: unknown[]) => unknown) => {
				hooks.push({ event, handler });
			},
		} as unknown as ExtensionAPI;

		googleUrlContextExtension(pi);

		expect(hooks.map((hook) => hook.event)).toEqual(["before_provider_request", "before_agent_start"]);

		const providerHook = hooks[0];
		const providerResult = providerHook.handler(
			{ payload: { tools: [] } },
			{ model: { api: "google-generative-ai" } },
		) as { tools: Array<Record<string, unknown>> };
		expect(providerResult.tools).toContainEqual({ urlContext: {} });

		const agentHook = hooks[1];
		const agentResult = (await agentHook.handler(
			{ systemPrompt: "base" },
			{ model: { api: "google-generative-ai" } },
		)) as { systemPrompt: string };
		expect(agentResult.systemPrompt).toContain("## URL Context");
	});
});
