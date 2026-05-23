import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { filterHistory } from "../../src/core/extensions/builtin/history-search/filter.ts";
import historySearchExtension from "../../src/core/extensions/builtin/history-search/index.ts";
import { indexSessions } from "../../src/core/extensions/builtin/history-search/indexer.ts";
import { HistorySearchOverlay } from "../../src/core/extensions/builtin/history-search/overlay.ts";
import type { HistoryEntry } from "../../src/core/extensions/builtin/history-search/types.ts";
import { Theme } from "../../src/modes/interactive/theme/theme.ts";
import { createHarness, type Harness } from "./harness.ts";

const BASE_TIME = Date.parse("2026-05-20T12:00:00.000Z");
const tempRoots: string[] = [];
const harnesses: Harness[] = [];

const testFgColors = {
	accent: "",
	border: "",
	borderAccent: "",
	borderMuted: "",
	success: "",
	error: "",
	warning: "",
	muted: "",
	dim: "",
	text: "",
	thinkingText: "",
	userMessageText: "",
	customMessageText: "",
	customMessageLabel: "",
	toolTitle: "",
	toolOutput: "",
	mdHeading: "",
	mdLink: "",
	mdLinkUrl: "",
	mdCode: "",
	mdCodeBlock: "",
	mdCodeBlockBorder: "",
	mdQuote: "",
	mdQuoteBorder: "",
	mdHr: "",
	mdListBullet: "",
	toolDiffAdded: "",
	toolDiffRemoved: "",
	toolDiffContext: "",
	syntaxComment: "",
	syntaxKeyword: "",
	syntaxFunction: "",
	syntaxVariable: "",
	syntaxString: "",
	syntaxNumber: "",
	syntaxType: "",
	syntaxOperator: "",
	syntaxPunctuation: "",
	thinkingOff: "",
	thinkingMinimal: "",
	thinkingLow: "",
	thinkingMedium: "",
	thinkingHigh: "",
	thinkingXhigh: "",
	bashMode: "",
};

const testBgColors = {
	selectedBg: "",
	userMessageBg: "",
	customMessageBg: "",
	toolPendingBg: "",
	toolSuccessBg: "",
	toolErrorBg: "",
};

const testTheme = new Theme(testFgColors, testBgColors, "256color");

afterEach(async () => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	for (const root of tempRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function makeTempRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "senpi-history-search-"));
	tempRoots.push(root);
	return root;
}

function sessionLine(sessionId = "session-1", cwd = "/workspace", timestamp = BASE_TIME): string {
	return JSON.stringify({ type: "session", id: sessionId, timestamp: new Date(timestamp).toISOString(), cwd });
}

function userLine(textParts: readonly string[], timestamp = BASE_TIME + 1_000): string {
	return JSON.stringify({
		type: "message",
		id: `msg-${timestamp}`,
		parentId: "parent",
		timestamp: new Date(timestamp).toISOString(),
		message: { role: "user", content: textParts.map((text) => ({ type: "text", text })) },
	});
}

async function writeSessionFile(sessionsDir: string, fileName: string, lines: readonly string[]): Promise<string> {
	const dir = join(sessionsDir, "encoded-cwd");
	await mkdir(dir, { recursive: true });
	const file = join(dir, fileName);
	await writeFile(file, `${lines.join("\n")}\n`, "utf-8");
	return file;
}

function historyEntry(text: string, timestamp: number): HistoryEntry {
	return { text, sessionId: "s", sessionFile: "/tmp/s.jsonl", cwd: "/repo", timestamp };
}

describe("indexSessions", () => {
	it("returns empty arrays for missing or empty session dirs", async () => {
		const root = await makeTempRoot();
		expect(await indexSessions(join(root, "missing"))).toEqual([]);
		const empty = join(root, "sessions");
		await mkdir(empty);
		expect(await indexSessions(empty)).toEqual([]);
	});

	it("parses a single jsonl user prompt", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "sessions");
		const file = await writeSessionFile(sessionsDir, "20260520_session-1.jsonl", [
			sessionLine("session-1", "/repo", BASE_TIME),
			userLine(["ship it"], BASE_TIME + 2_000),
		]);

		expect(await indexSessions(sessionsDir)).toEqual([
			{ text: "ship it", sessionId: "session-1", sessionFile: file, cwd: "/repo", timestamp: BASE_TIME + 2_000 },
		]);
	});

	it("skips injected, empty, and malformed prompt lines", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "sessions");
		await writeSessionFile(sessionsDir, "session.jsonl", [
			sessionLine(),
			"{malformed",
			userLine(["[SYSTEM DIRECTIVE: hidden]"], BASE_TIME + 1_000),
			userLine(["[system:agentika:user.input]\nsecret"], BASE_TIME + 2_000),
			userLine(["[SYSTEM hidden]"], BASE_TIME + 3_000),
			userLine(["   \n\t"], BASE_TIME + 4_000),
			userLine(["visible"], BASE_TIME + 5_000),
		]);

		expect((await indexSessions(sessionsDir)).map((item) => item.text)).toEqual(["visible"]);
	});

	it("concatenates text parts, sorts newest first, and deduplicates newest text", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "sessions");
		await writeSessionFile(sessionsDir, "older.jsonl", [
			sessionLine("older"),
			userLine(["multi", "part"], BASE_TIME + 1_000),
			userLine(["duplicate"], BASE_TIME + 2_000),
		]);
		await writeSessionFile(sessionsDir, "newer.jsonl", [
			sessionLine("newer"),
			userLine(["duplicate"], BASE_TIME + 4_000),
			userLine(["latest"], BASE_TIME + 5_000),
		]);

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toEqual(["latest", "duplicate", "multi\npart"]);
		expect(entries.find((item) => item.text === "duplicate")?.sessionId).toBe("newer");
	});

	it("caps indexed entries at 10000", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "sessions");
		const lines = [sessionLine("bulk")];
		for (let index = 0; index < 10_005; index++) lines.push(userLine([`prompt ${index}`], BASE_TIME + index));
		await writeSessionFile(sessionsDir, "bulk.jsonl", lines);

		expect(await indexSessions(sessionsDir)).toHaveLength(10_000);
	});

	it("indexes .jsonl files at the top level (custom session dir layout)", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "custom");
		await mkdir(sessionsDir);
		const flatFile = join(sessionsDir, "20260520_flat-session.jsonl");
		await writeFile(
			flatFile,
			[sessionLine("flat-session", "/repo", BASE_TIME), userLine(["flat prompt"], BASE_TIME + 1_000)].join("\n"),
			"utf-8",
		);

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toEqual(["flat prompt"]);
		expect(entries[0]?.sessionFile).toBe(flatFile);
	});

	it("prioritizes newest filenames globally across cwd subdirs when capping", async () => {
		const root = await makeTempRoot();
		const sessionsDir = join(root, "sessions");
		const olderDir = join(sessionsDir, "aaaaa-old-cwd");
		const newerDir = join(sessionsDir, "zzzzz-new-cwd");
		await mkdir(olderDir, { recursive: true });
		await mkdir(newerDir, { recursive: true });

		const olderLines = [sessionLine("old-bulk", "/old", BASE_TIME)];
		for (let index = 0; index < 10_000; index++) {
			olderLines.push(userLine([`old prompt ${index}`], BASE_TIME + index));
		}
		await writeFile(join(olderDir, "20260101_old-bulk.jsonl"), olderLines.join("\n"), "utf-8");

		const newerLines = [
			sessionLine("new-recent", "/new", BASE_TIME + 1_000_000),
			userLine(["fresh prompt"], BASE_TIME + 2_000_000),
		];
		await writeFile(join(newerDir, "20260901_new-recent.jsonl"), newerLines.join("\n"), "utf-8");

		const entries = await indexSessions(sessionsDir);
		expect(entries.map((item) => item.text)).toContain("fresh prompt");
	});
});

describe("filterHistory", () => {
	it("keeps empty-query order and fuzzy filters case-insensitively", () => {
		const entries: readonly HistoryEntry[] = [
			historyEntry("Newest prompt", 3),
			historyEntry("Deploy production", 2),
			historyEntry("older", 1),
		];
		expect(filterHistory(entries, "")).toEqual(entries);
		expect(filterHistory(entries, "DProd").map((item) => item.text)).toEqual(["Deploy production"]);
	});

	it("ranks tighter matches above looser matches", () => {
		const entries: readonly HistoryEntry[] = [
			historyEntry("deploy dev prod", 2),
			historyEntry("deploy production", 1),
		];
		expect(filterHistory(entries, "dprod").map((item) => item.text)).toEqual([
			"deploy production",
			"deploy dev prod",
		]);
	});
});

describe("HistorySearchOverlay", () => {
	it("renders an input and filters after synthetic keystrokes", () => {
		let renderRequests = 0;
		const tui = {
			requestRender: () => {
				renderRequests += 1;
			},
		};
		const entries: readonly HistoryEntry[] = [
			historyEntry("ship release", 3),
			historyEntry("build project", 2),
			historyEntry("write tests", 1),
		];
		const overlay = new HistorySearchOverlay({ tui, entries, theme: testTheme, done: () => {} });

		overlay.focused = true;
		overlay.handleInput("b");

		expect(overlay.getSearchValue()).toBe("b");
		expect(overlay.getFilteredEntries().map((item) => item.text)).toEqual(["build project"]);
		const renderedLines = overlay.render(80);
		expect(renderedLines.some((line) => line.includes("> b"))).toBe(true);
		expect(renderedLines.some((line) => line.includes("1/3 prompts"))).toBe(true);
		expect(renderRequests).toBe(1);
	});
});

describe("historySearchExtension", () => {
	it("registers /history and handles no-UI command execution", async () => {
		const root = await makeTempRoot();
		const previousDir = process.env.SENPI_CODING_AGENT_DIR;
		process.env.SENPI_CODING_AGENT_DIR = root;
		try {
			const harness = await createHarness({ extensionFactories: [historySearchExtension] });
			harnesses.push(harness);
			const command = harness.session.extensionRunner
				.getRegisteredCommands()
				.find((item) => item.name === "history");
			expect(command?.invocationName).toBe("history");

			await harness.session.prompt("/history");
			expect(harness.session.messages).toEqual([]);
		} finally {
			if (previousDir === undefined) delete process.env.SENPI_CODING_AGENT_DIR;
			else process.env.SENPI_CODING_AGENT_DIR = previousDir;
		}
	});
});
