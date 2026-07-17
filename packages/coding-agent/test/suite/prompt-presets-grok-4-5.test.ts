import { readFileSync } from "node:fs";
import { type Api, getModels, getProviders, type Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	type PromptPresetSettings,
	resolvePreset,
	resolvePresetName,
} from "../../src/core/extensions/builtin/prompt-preset/presets.ts";

function createModel(id: string, provider: string, api: Api = "openai-responses"): Model<Api> {
	return {
		id,
		name: id,
		api,
		provider,
		baseUrl: "https://example.com/v1",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 16_384,
	};
}

function hasGrok45CatalogSignal(model: Model<Api>): boolean {
	const searchable = `${model.id} ${model.name}`.toLowerCase().replace(/\s+/g, "-");
	// Keep in sync with presets.ts hasGrok45Signal — colon provider sep + compact grok45.
	return /(?:^|[/@:._-])grok(?:[._-]|p)?4(?:[._-]|p)?5(?:$|[/@._:-])/.test(searchable);
}

function getGrok45CatalogModels(): Model<Api>[] {
	return getProviders().flatMap((provider) => (getModels(provider) as Model<Api>[]).filter(hasGrok45CatalogSignal));
}

describe("Grok 4.5 prompt preset", () => {
	it.each([
		"grok-4.5",
		"Grok 4.5",
		"xai/grok-4.5",
		"x-ai/grok-4.5",
		"xai:grok-4.5",
		"grok-4p5",
		"grok_4_5:thinking",
		"grok45",
		"Grok4.5",
		"grok-4.5-latest",
		"grok-4.5-thinking",
		"accounts/xai/models/grok-4.5",
	])("resolves %s to the grok-4.5 preset", (modelId) => {
		// given
		const settings: PromptPresetSettings = { promptPreset: "auto" };
		const model = createModel(modelId, "xai", "openai-responses");

		// when
		const preset = resolvePreset(model, settings);

		// then
		expect(preset?.name).toBe("grok-4.5");
		expect(preset?.prompt).toMatch(/when you have enough information to act, act/i);
		expect(preset?.prompt).toMatch(/do not re-derive facts already established/i);
		expect(preset?.prompt).toMatch(/give a recommendation, not a survey/i);
		expect(preset?.prompt).toMatch(/audit each claim against a tool result from this session/i);
		expect(preset?.prompt).toMatch(/if tests fail, say so with the output/i);
		expect(preset?.prompt).toMatch(/pause for the user only when the work genuinely requires them/i);
		expect(preset?.prompt).toMatch(/before ending your turn, check your last paragraph/i);
		expect(preset?.prompt).toMatch(/lead with the outcome in complete sentences/i);
		expect(preset?.prompt).toMatch(/do not stop, summarize, or suggest a new session on account of context limits/i);
		const tuningAt = preset?.prompt.search(/when you have enough information to act, act/i) ?? -1;
		const tuning = tuningAt >= 0 ? (preset?.prompt.slice(tuningAt) ?? "") : "";
		expect(tuning.length).toBeGreaterThan(900);
		expect(tuning.length).toBeLessThan(1800);
		expect(tuning).not.toMatch(/you are Fable 5|persistent operational identity|Kimi-K2-descended/i);
		expect(tuning).not.toMatch(/Intent gate: \[DIRECT \| DEEP \| BLOCKED\]/i);
		expect(preset?.prompt).not.toContain("apply_patch");
	});

	it.each([
		"grok-4.3",
		"grok-4.20-0309-reasoning",
		"grok-3",
		"grok-code-fast-1",
		"some-grok-compatible-router",
	])("does not route %s to the grok-4.5 preset", (modelId) => {
		// given
		const settings: PromptPresetSettings = { promptPreset: "auto" };
		const model = createModel(modelId, "xai", "openai-responses");

		// when
		const preset = resolvePreset(model, settings);

		// then
		expect(preset).toBeUndefined();
	});

	it("allows settings.json to force grok-4.5 regardless of model id", () => {
		// given
		const settings: PromptPresetSettings = { promptPreset: "grok-4.5" };
		const model = createModel("some-random-model", "custom", "openai-responses");

		// when
		const preset = resolvePreset(model, settings);

		// then
		expect(preset?.name).toBe("grok-4.5");
		expect(preset?.prompt).toMatch(/when you have enough information to act, act/i);
		expect(preset?.prompt).toMatch(/audit each claim against a tool result from this session/i);
	});

	it("returns grok-4.5 preset for every Grok 4.5 built-in catalog model", () => {
		// given
		const settings: PromptPresetSettings = { promptPreset: "auto" };
		const catalogModels = getGrok45CatalogModels();
		const catalogModelIds = catalogModels.map((model) => `${model.provider}/${model.id}`);

		// when
		const misses = catalogModels
			.filter((model) => resolvePresetName(model, settings) !== "grok-4.5")
			.map((model) => `${model.provider}/${model.id}`);

		// then
		expect(catalogModelIds).toEqual(
			expect.arrayContaining([
				"xai/grok-4.5",
				"opencode/grok-4.5",
				"openrouter/x-ai/grok-4.5",
				"vercel-ai-gateway/xai/grok-4.5",
			]),
		);
		expect(misses).toEqual([]);
	});

	it("does not invent Grok preset edition numbers while unreleased", () => {
		// given — Grok 4.5 has never been formally merged; fake v1/v2/… theater is noise
		const changesPath = new URL("../../src/core/extensions/builtin/prompt-preset/changes.md", import.meta.url);
		const changes = readFileSync(changesPath, "utf8");

		// then
		expect(changes).toMatch(/Grok 4\.5 preset \(unreleased/);
		expect(changes).not.toMatch(/Grok 4\.5 preset v\d+/);
	});
});
