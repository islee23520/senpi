import assert from "node:assert";
import { describe, it } from "node:test";
import { type Component, TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

/**
 * Models a terminal whose glyph widths disagree with the renderer's
 * visibleWidth() measurement: the renderer believes `believedColumns` fit on a
 * row, but the terminal actually wraps at the real (smaller) column count.
 * Real-world triggers: East-Asian-ambiguous characters rendered double-width,
 * emoji newer than the terminal's Unicode tables, decomposed Hangul jamo.
 */
class NarrowerRealTerminal extends VirtualTerminal {
	private believedColumns: number;

	constructor(realColumns: number, rows: number, believedColumns: number) {
		super(realColumns, rows);
		this.believedColumns = believedColumns;
	}

	override get columns(): number {
		return this.believedColumns;
	}
}

class LinesComponent implements Component {
	lines: string[] = [];

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

describe("TUI wrap desync ghost line", () => {
	it("does not leave a ghost loader line after an in-place line growth physically wraps", async () => {
		const realColumns = 40;
		const believedColumns = 42;
		const term = new NarrowerRealTerminal(realColumns, 14, believedColumns);
		const ui = new TUI(term);
		const component = new LinesComponent();
		ui.addChild(component);
		ui.start();

		// Frame 1: streaming text above a loader, editor, and footer.
		component.lines = ["streaming: short", "", "* Working (0s - esc to interrupt)", "", "+--editor--+", "footer"];
		ui.requestRender();
		await term.waitForRender();

		// Frame 2: the streaming line grows in place to the believed width.
		// The real terminal is 2 columns narrower, so the row physically wraps
		// while the loader row below is diff-skipped (its content is unchanged).
		component.lines = [...component.lines];
		component.lines[0] = `streaming: ${"x".repeat(believedColumns - "streaming: ".length)}`;
		ui.requestRender();
		await term.waitForRender();

		// Frame 3: only the loader seconds tick changes.
		component.lines = [...component.lines];
		component.lines[2] = "* Working (2s - esc to interrupt)";
		ui.requestRender();
		await term.waitForRender();

		const viewport = term.getViewport();
		const loaderLines = viewport.filter((line) => line.includes("Working ("));
		assert.deepStrictEqual(
			loaderLines,
			["* Working (2s - esc to interrupt)"],
			`stale loader ghost left behind after wrap desync:\n${viewport.map((line, i) => `${i}: ${JSON.stringify(line)}`).join("\n")}`,
		);

		// The rows below the loader must not shift down.
		assert.strictEqual(viewport[4], "+--editor--+");
		assert.strictEqual(viewport[5], "footer");

		ui.stop();
	});

	it("keeps every row aligned when a full-width message box renders wider than measured", async () => {
		const realColumns = 40;
		const believedColumns = 42;
		const term = new NarrowerRealTerminal(realColumns, 14, believedColumns);
		const ui = new TUI(term);
		const component = new LinesComponent();
		ui.addChild(component);
		ui.start();

		// Frame 1: base UI without any over-wide row.
		component.lines = ["transcript line", "", "* Working (0s - esc to interrupt)", "", "+--editor--+", "footer"];
		ui.requestRender();
		await term.waitForRender();

		// Frame 2: a full-width padded message box is inserted above the loader.
		component.lines = [
			"transcript line",
			"",
			"M".repeat(believedColumns),
			"",
			"* Working (0s - esc to interrupt)",
			"",
			"+--editor--+",
			"footer",
		];
		ui.requestRender();
		await term.waitForRender();

		// Frame 3: loader tick.
		component.lines = [...component.lines];
		component.lines[4] = "* Working (2s - esc to interrupt)";
		ui.requestRender();
		await term.waitForRender();

		const viewport = term.getViewport();
		const loaderLines = viewport.filter((line) => line.includes("Working ("));
		assert.deepStrictEqual(
			loaderLines,
			["* Working (2s - esc to interrupt)"],
			`duplicate/ghost loader after over-wide message box:\n${viewport.map((line, i) => `${i}: ${JSON.stringify(line)}`).join("\n")}`,
		);
		// The over-wide row is clipped to the real width instead of spilling
		// onto the next row and shifting everything below.
		assert.strictEqual(viewport[2], "M".repeat(realColumns));
		assert.strictEqual(viewport[3], "");
		assert.strictEqual(viewport[6], "+--editor--+");
		assert.strictEqual(viewport[7], "footer");

		ui.stop();
	});
});
