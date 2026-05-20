import { afterEach, describe, expect, it } from "vitest";
import {
	ANTHROPIC_BASH_SECTION,
	addAnthropicBashToPayload,
	isAnthropicBashEnabled,
} from "../../src/core/extensions/builtin/anthropic-bash/index.ts";

const ANTHROPIC_BASH_ENV = "PI_ANTHROPIC_BASH";

afterEach(() => {
	delete process.env[ANTHROPIC_BASH_ENV];
});

describe("anthropic-bash builtin extension", () => {
	it("is a no-op when env var is unset, even on anthropic-messages", () => {
		const payload = {
			tools: [{ name: "some_tool", description: "function tool" }],
		};

		const result = addAnthropicBashToPayload("anthropic-messages", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op for explicitly disabled env values", () => {
		const payload = {
			tools: [{ name: "bash", description: "function bash", input_schema: { type: "object" } }],
		};

		for (const envValue of ["0", "false", "no", "off", ""] as const) {
			process.env[ANTHROPIC_BASH_ENV] = envValue;
			expect(addAnthropicBashToPayload("anthropic-messages", payload)).toBe(payload);
		}
	});

	it("is a no-op when api is openai-responses", () => {
		process.env[ANTHROPIC_BASH_ENV] = "on";
		const payload = {
			tools: [{ name: "bash", description: "function bash", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("openai-responses", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is openai-completions", () => {
		process.env[ANTHROPIC_BASH_ENV] = "yes";
		const payload = {
			tools: [{ name: "bash", description: "function bash", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("openai-completions", payload);

		expect(result).toBe(payload);
	});

	it("is a no-op when api is google-generative-ai", () => {
		process.env[ANTHROPIC_BASH_ENV] = "1";
		const payload = {
			tools: [{ name: "bash", description: "function bash", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("google-generative-ai", payload);

		expect(result).toBe(payload);
	});

	it("injects native bash_20250124 when enabled and no native tool exists", () => {
		process.env[ANTHROPIC_BASH_ENV] = "true";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ name: "read", description: "function read" }],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({
			type: "bash_20250124",
			name: "bash",
		});
	});

	it("strips function-shape bash and replaces with native when enabled", () => {
		process.env[ANTHROPIC_BASH_ENV] = "true";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [
				{ name: "bash", description: "bash function", input_schema: { type: "object" } },
				{ name: "read", description: "read function" },
			],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({
			type: "bash_20250124",
			name: "bash",
		});
		expect(result.tools).not.toContainEqual({
			name: "bash",
			description: "bash function",
			input_schema: { type: "object" },
		});
	});

	it("preserves caller-supplied bash_20250124 without duplication", () => {
		process.env[ANTHROPIC_BASH_ENV] = "on";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ type: "bash_20250124", name: "bash" }],
		}) as { tools: Array<Record<string, unknown>> };

		const bashTools = result.tools.filter((tool) => tool.name === "bash");
		expect(bashTools).toHaveLength(1);
		expect(bashTools[0]).toEqual({ type: "bash_20250124", name: "bash" });
	});

	it("preserves caller-supplied other native bash version without overwrite", () => {
		process.env[ANTHROPIC_BASH_ENV] = "on";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ type: "bash_20251215", name: "bash" }],
		}) as { tools: Array<Record<string, unknown>> };

		const bashTools = result.tools.filter((tool) => tool.name === "bash");
		expect(bashTools).toHaveLength(1);
		expect(bashTools[0]).toEqual({ type: "bash_20251215", name: "bash" });
	});

	it("does not strip function-shape bash when env disabled", () => {
		const payload = {
			tools: [{ name: "bash", description: "bash function", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("anthropic-messages", payload);
		expect(result).toBe(payload);
	});

	it("does not strip function-shape bash when api does not match", () => {
		process.env[ANTHROPIC_BASH_ENV] = "true";
		const payload = {
			tools: [{ name: "bash", description: "bash function", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("openai-responses", payload) as {
			tools: Array<Record<string, unknown>>;
		};

		expect(result.tools).toEqual(payload.tools);
	});

	it("does not strip tool with name Bash (case-sensitive)", () => {
		process.env[ANTHROPIC_BASH_ENV] = "yes";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ name: "Bash", description: "different case" }],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({ name: "Bash", description: "different case" });
	});

	it("does not strip tool with different name", () => {
		process.env[ANTHROPIC_BASH_ENV] = "yes";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ name: "shell", description: "different name" }],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({ name: "shell", description: "different name" });
	});

	it("preserves other tools untouched", () => {
		process.env[ANTHROPIC_BASH_ENV] = "1";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [{ name: "read", description: "read function", input_schema: { type: "object" } }],
		}) as { tools: Array<Record<string, unknown>> };

		expect(result.tools).toContainEqual({
			name: "read",
			description: "read function",
			input_schema: { type: "object" },
		});
	});

	it("strips function bash and preserves native bash without duplication", () => {
		process.env[ANTHROPIC_BASH_ENV] = "on";

		const result = addAnthropicBashToPayload("anthropic-messages", {
			tools: [
				{ name: "bash", description: "function bash", input_schema: { type: "object" } },
				{ type: "bash_20250124", name: "bash" },
			],
		}) as { tools: Array<Record<string, unknown>> };

		const bashTools = result.tools.filter((tool) => tool.name === "bash");
		expect(bashTools).toHaveLength(1);
		expect(bashTools[0]).toEqual({ type: "bash_20250124", name: "bash" });
	});

	it("isAnthropicBashEnabled returns false when env is unset", () => {
		expect(isAnthropicBashEnabled()).toBe(false);
	});

	it("isAnthropicBashEnabled returns true for truthy values", () => {
		for (const envValue of ["1", "true", "yes", "on", " TRUE ", "\tYes\n"] as const) {
			process.env[ANTHROPIC_BASH_ENV] = envValue;
			expect(isAnthropicBashEnabled()).toBe(true);
		}
	});

	it("isAnthropicBashEnabled returns false for falsy or unknown values", () => {
		for (const envValue of ["0", "false", "no", "off", "", "garbage", "2", "enable"] as const) {
			process.env[ANTHROPIC_BASH_ENV] = envValue;
			expect(isAnthropicBashEnabled()).toBe(false);
		}
	});

	it("ANTHROPIC_BASH_SECTION is non-empty and mentions bash", () => {
		expect(ANTHROPIC_BASH_SECTION.trim().length).toBeGreaterThan(0);
		expect(ANTHROPIC_BASH_SECTION.toLowerCase()).toContain("bash");
	});

	it("returns a new object when mutating tools for injection/stripping", () => {
		process.env[ANTHROPIC_BASH_ENV] = "on";
		const payload = {
			tools: [{ name: "bash", description: "function bash", input_schema: { type: "object" } }],
		};

		const result = addAnthropicBashToPayload("anthropic-messages", payload);

		expect(result).not.toBe(payload);
	});
});
