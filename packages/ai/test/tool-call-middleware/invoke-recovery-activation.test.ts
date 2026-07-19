import { describe, expect, it } from "vitest";
import { shouldRecoverTextToolCalls } from "../../src/index.ts";
import type { Model } from "../../src/types.ts";

function createModel(id: string, overrides: Partial<Model<"openai-completions">> = {}): Model<"openai-completions"> {
	return {
		id,
		name: id,
		api: "openai-completions",
		provider: "test-provider",
		baseUrl: "https://example.test/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 8192,
		...overrides,
	};
}

describe("invoke recovery activation", () => {
	it("auto-enables only bounded Claude-family model ids", () => {
		for (const id of ["claude", "anthropic/claude-opus", "x-claude", "claude_opus", "CLAUDE.SONNET@2025"]) {
			expect(shouldRecoverTextToolCalls(createModel(id))).toBe(true);
		}

		for (const id of ["claudel", "myclaude", "claude3", "exclaude", "claudius", "gpt-5"]) {
			expect(shouldRecoverTextToolCalls(createModel(id))).toBe(false);
		}

		const differentProvider = createModel("claude", { provider: "unrelated-provider" });
		expect(shouldRecoverTextToolCalls(differentProvider)).toBe(true);

		const differentApi: Model<"anthropic-messages"> = {
			...createModel("claude"),
			api: "anthropic-messages",
			provider: "another-provider",
		};
		expect(shouldRecoverTextToolCalls(differentApi)).toBe(true);
	});

	it("honors explicit tri-state overrides and text-protocol exclusion", () => {
		expect(shouldRecoverTextToolCalls(createModel("claude-opus", { recoverTextToolCalls: false }))).toBe(false);
		expect(shouldRecoverTextToolCalls(createModel("gpt-5", { recoverTextToolCalls: true }))).toBe(true);
		expect(shouldRecoverTextToolCalls(createModel("claude-opus", { recoverTextToolCalls: true }))).toBe(true);
		expect(
			shouldRecoverTextToolCalls(
				createModel("claude-opus", {
					recoverTextToolCalls: true,
					compat: { toolCallFormat: "antml" },
				}),
			),
		).toBe(false);
	});
});
