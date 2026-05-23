import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { filterHistory } from "../../src/core/extensions/builtin/history-search/filter.ts";
import historySearchExtension, { resolveSearchRoot } from "../../src/core/extensions/builtin/history-search/index.ts";
import { HistorySearchOverlay } from "../../src/core/extensions/builtin/history-search/overlay.ts";
import type { HistoryEntry } from "../../src/core/extensions/builtin/history-search/types.ts";
import { createHarness, type Harness } from "./harness.ts";
import { createTempRootRegistry, historyEntry, testTheme } from "./history-search-fixtures.ts";

const tempRoots = createTempRootRegistry();
const harnesses: Harness[] = [];

afterEach(async () => {
	for (const harness of harnesses.splice(0)) harness.cleanup();
	await tempRoots.cleanup();
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

describe("resolveSearchRoot", () => {
	const defaultRoot = "/home/user/.senpi/agent/sessions";

	it("returns default root when sessionDir is empty (in-memory mode)", () => {
		expect(resolveSearchRoot("", defaultRoot)).toBe(defaultRoot);
	});

	it("returns default root when sessionDir equals default root", () => {
		expect(resolveSearchRoot(defaultRoot, defaultRoot)).toBe(defaultRoot);
	});

	it("returns default root for cwd-subdir layout (cross-cwd search)", () => {
		expect(resolveSearchRoot(`${defaultRoot}/-encoded-cwd`, defaultRoot)).toBe(defaultRoot);
		expect(resolveSearchRoot(`${defaultRoot}/deep/nested/path`, defaultRoot)).toBe(defaultRoot);
	});

	it("returns the custom dir when sessionDir is outside default root", () => {
		expect(resolveSearchRoot("/custom/session/dir", defaultRoot)).toBe("/custom/session/dir");
		expect(resolveSearchRoot("/tmp/my-sessions", defaultRoot)).toBe("/tmp/my-sessions");
	});

	it("treats cwd-subdirs as descendants on Windows path semantics", () => {
		const winRoot = "C:\\Users\\u\\.senpi\\agent\\sessions";
		expect(resolveSearchRoot(`${winRoot}\\encoded-cwd`, winRoot, path.win32)).toBe(path.win32.resolve(winRoot));
		expect(resolveSearchRoot("D:\\other\\sessions", winRoot, path.win32)).toBe(
			path.win32.resolve("D:\\other\\sessions"),
		);
	});
});

describe("historySearchExtension", () => {
	it("registers /history and handles no-UI command execution", async () => {
		const root = await tempRoots.make();
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
