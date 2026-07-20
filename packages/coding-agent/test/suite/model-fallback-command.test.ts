import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import modelFallbackExtension, {
	isModelFallbackDisabled,
} from "../../src/core/extensions/builtin/model-fallback/index.ts";
import type { ExtensionAPI, ExtensionCommandContext } from "../../src/core/extensions/types.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

const dirs: string[] = [];
let previousAgentDir: string | undefined;
const primary = model("anthropic", "claude-fable-5", true);
const fallback = model("ccapi", "kimi-k3", true);

type Command = {
	description?: string;
	argumentHint?: string;
	handler(args: string, ctx: ExtensionCommandContext): Promise<void>;
};

function model(provider: string, id: string, reasoning: boolean): Model<Api> {
	return {
		provider,
		id,
		name: id,
		api: "faux",
		reasoning,
		thinkingLevelMap: { max: "max" },
		input: ["text"],
		contextWindow: 1,
		maxTokens: 1,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
}

function harness(): Map<string, Command> {
	const commands = new Map<string, Command>();
	const pi = {
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		registerFlag: () => {},
		getFlag: () => false,
		on: () => {},
	} as unknown as ExtensionAPI;
	modelFallbackExtension(pi);
	return commands;
}

async function context(dir: string, notices: string[], choices: string[] = []): Promise<ExtensionCommandContext> {
	const settings = SettingsManager.create(dir);
	return {
		cwd: dir,
		hasUI: choices.length > 0,
		modelRegistry: {
			getAll: () => [primary, fallback],
			getAvailable: () => [primary, fallback],
			find: (provider: string, id: string) =>
				[primary, fallback].find((item) => item.provider === provider && item.id === id),
		},
		sessionSettings: {
			getRetryFallbackSettings: () => settings.getRetryFallbackSettings(),
			setFallbackChain: async (key, entries) => {
				settings.setFallbackChain(key, [...entries]);
				await settings.flush();
			},
			removeFallbackChain: async (key) => {
				settings.removeFallbackChain(key);
				await settings.flush();
			},
			setModelFallbackEnabled: async (enabled) => {
				settings.setModelFallbackEnabled(enabled);
				await settings.flush();
			},
			setFallbackRevertPolicy: async (policy) => {
				settings.setFallbackRevertPolicy(policy);
				await settings.flush();
			},
			reload: () => settings.reload(),
			getFallbackStatus: () => undefined,
		},
		ui: { notify: (message: string) => notices.push(message), select: async () => choices.shift() },
	} as unknown as ExtensionCommandContext;
}

describe("model fallback builtin command", () => {
	beforeEach(async () => {
		previousAgentDir = process.env.SENPI_CODING_AGENT_DIR;
		const agentDir = await mkdtemp(join(tmpdir(), "senpi-fallback-agent-"));
		dirs.push(agentDir);
		process.env.SENPI_CODING_AGENT_DIR = agentDir;
	});
	afterEach(async () => {
		if (previousAgentDir === undefined) delete process.env.SENPI_CODING_AGENT_DIR;
		else process.env.SENPI_CODING_AGENT_DIR = previousAgentDir;
		await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("registers /fallback with its quick-set hint", () => {
		const command = harness().get("fallback");
		expect(command?.argumentHint).toBe("[target [fallback1 fallback2 ...]]");
		expect(command?.description).toContain("fallback");
	});

	it("quick-set validates and persists a chain visible after a session-side reload", async () => {
		const dir = await mkdtemp(join(tmpdir(), "senpi-fallback-command-"));
		dirs.push(dir);
		const notices: string[] = [];
		const command = harness().get("fallback");
		const sessionSideSettings = SettingsManager.create(dir);
		await command?.handler("anthropic/claude-fable-5 ccapi/kimi-k3:max", await context(dir, notices));
		await sessionSideSettings.reload();
		expect(sessionSideSettings.getRetryFallbackSettings().chains).toEqual({
			"anthropic/claude-fable-5": ["ccapi/kimi-k3:max"],
		});
		expect(notices).toContain("Fallback chain saved for anthropic/claude-fable-5.");
	});

	it("rejects an invalid quick-set without writing settings", async () => {
		const dir = await mkdtemp(join(tmpdir(), "senpi-fallback-command-"));
		dirs.push(dir);
		const notices: string[] = [];
		await harness()
			.get("fallback")
			?.handler("bogus/model nope", await context(dir, notices));
		expect(SettingsManager.create(dir).getRetryFallbackSettings().chains).toEqual({});
		expect(notices.join("\n")).toContain("not a valid or known model selector");
	});

	it("maps the CLI flag and environment escape hatch to a disabled run override", () => {
		expect(isModelFallbackDisabled(true, {})).toBe(true);
		expect(isModelFallbackDisabled(false, { SENPI_NO_FALLBACK: "1" })).toBe(true);
		expect(isModelFallbackDisabled(false, {})).toBe(false);
	});

	it("handles a headless menu invocation cleanly", async () => {
		const dir = await mkdtemp(join(tmpdir(), "senpi-fallback-command-"));
		dirs.push(dir);
		const notices: string[] = [];
		await harness()
			.get("fallback")
			?.handler("", await context(dir, notices));
		expect(notices).toContain("Fallback menu requires interactive UI. Use /fallback <target> <fallback...>.");
	});
});
