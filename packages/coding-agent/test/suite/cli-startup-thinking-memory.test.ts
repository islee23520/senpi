import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseArgs } from "../../src/cli/args.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";
import { createCliRuntimeFactory } from "../../src/main.ts";

describe("CLI startup thinking memory", () => {
	let scratch: string;
	let cwd: string;
	let agentDir: string;
	const provider = "openai";
	const modelId = "gpt-6.1-sol";
	const key = `${provider}/${modelId}`;

	beforeEach(() => {
		scratch = mkdtempSync(join(tmpdir(), "senpi-startup-memory-"));
		cwd = join(scratch, "cwd");
		agentDir = join(scratch, "agent");
		mkdirSync(cwd);
		mkdirSync(agentDir);
		vi.stubEnv("SENPI_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("OMO_CODING_AGENT_DIR", agentDir);
		vi.stubEnv("PI_OFFLINE", "1");
		vi.stubEnv("SENPI_OFFLINE", "1");
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({
				defaultProvider: provider,
				defaultModel: modelId,
				defaultThinkingLevel: "high",
				modelThinkingLevels: { [key]: "high" },
				modelLastOnThinkingLevels: { [key]: "high" },
			}),
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(scratch, { recursive: true, force: true });
	});

	function factory(args: string[] = []) {
		const parsed = parseArgs([
			"--no-extensions",
			"--no-skills",
			"--no-prompt-templates",
			"--no-themes",
			"--no-context-files",
			...args,
		]);
		return createCliRuntimeFactory({ parsed, cwd, agentDir, appMode: "rpc" }, { extensionFactories: [] });
	}

	it.each(["medium", "xhigh"] as const)(
		"keeps manual high memory when a worker starts at %s",
		async (level) => {
			// Given: the main session's persisted manual preference is high.
			const create = factory();
			// When: a host starts a worker with category-selected reasoning.
			const child = await create({
				cwd,
				agentDir,
				sessionManager: SessionManager.inMemory(cwd),
				launchProfile: {
					cwd,
					sessionKind: "worker",
					creationModel: { provider, modelId },
					initialThinkingLevel: level,
				},
			});
			try {
				await child.services.settingsManager.flush();
				// Then: the child uses its reasoning without overwriting durable preferences.
				expect(child.session.thinkingLevel).toBe(level);
				const persisted = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"));
				expect(persisted.defaultThinkingLevel).toBe("high");
				expect(persisted.modelThinkingLevels[key]).toBe("high");
				expect(persisted.modelLastOnThinkingLevels[key]).toBe("high");
				const main = await create({ cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
				try {
					expect(main.session.thinkingLevel).toBe("high");
				} finally {
					main.session.dispose();
				}
			} finally {
				child.session.dispose();
			}
		},
		30_000,
	);

	it("remembers an explicit classic CLI thinking selection", async () => {
		// Given: a user explicitly selects a model and reasoning on the classic CLI.
		const create = factory(["--model", `${provider}/${modelId}`, "--thinking", "xhigh"]);
		// When: the session starts without a host launch profile.
		const opened = await create({ cwd, agentDir, sessionManager: SessionManager.inMemory(cwd) });
		try {
			await opened.services.settingsManager.flush();
			// Then: the existing user-selection persistence remains intact.
			expect(opened.session.thinkingLevel).toBe("xhigh");
			const saved = SettingsManager.create(cwd, agentDir);
			expect(saved.getModelThinkingLevel(provider, modelId)).toBe("xhigh");
			expect(saved.getModelLastOnThinkingLevel(provider, modelId)).toBe("xhigh");
		} finally {
			opened.session.dispose();
		}
	}, 30_000);
});
