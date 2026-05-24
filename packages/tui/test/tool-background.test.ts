import assert from "node:assert";
import { describe, it } from "node:test";
import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Text } from "../src/components/text.ts";
import { TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

type CellBackground = {
	readonly color: number;
	readonly isDefault: boolean;
	readonly isRgb: boolean;
};

function getCellBackground(terminal: VirtualTerminal, row: number, col: number): CellBackground {
	const xtermValue: unknown = Reflect.get(terminal, "xterm");
	assert.ok(isXtermTerminal(xtermValue), "VirtualTerminal should expose an xterm instance in tests");
	const xterm = xtermValue;
	const buffer = xterm.buffer.active;
	const line = buffer.getLine(buffer.viewportY + row);
	assert.ok(line, `Missing buffer line at row ${row}`);
	const cell = line.getCell(col);
	assert.ok(cell, `Missing cell at row ${row} col ${col}`);
	return {
		color: cell.getBgColor(),
		isDefault: cell.isBgDefault(),
		isRgb: cell.isBgRGB(),
	};
}

function isXtermTerminal(value: unknown): value is XtermTerminalType {
	return typeof value === "object" && value !== null && "buffer" in value;
}

describe("TUI tool background rendering", () => {
	it("#given tool background line with unclosed inner background #when rendering #then tail padding uses the tool background", async () => {
		// given
		const terminal = new VirtualTerminal(16, 4);
		const tui = new TUI(terminal);
		const toolBg = "\x1b[48;2;10;90;40m";
		const toolBgColor = 0x0a5a28;
		const innerBg = "\x1b[48;2;120;20;20m";
		const innerBgColor = 0x781414;
		tui.addChild(new Text(`${innerBg}tool`, 0, 0, (text) => `${toolBg}${text}\x1b[49m`));
		tui.addChild(new Text("assistant", 0, 0));

		try {
			// when
			tui.start();
			await terminal.waitForRender();

			// then
			const contentBackground = getCellBackground(terminal, 0, 0);
			const paddingBackground = getCellBackground(terminal, 0, 4);
			const assistantBackground = getCellBackground(terminal, 1, 0);
			assert.strictEqual(contentBackground.isRgb, true);
			assert.strictEqual(contentBackground.color, innerBgColor);
			assert.strictEqual(paddingBackground.isRgb, true);
			assert.strictEqual(paddingBackground.color, toolBgColor);
			assert.strictEqual(assistantBackground.isDefault, true);
		} finally {
			tui.stop();
		}
	});

	it("#given adjacent tool background lines with a separator #when rendering #then each padding region keeps its own background", async () => {
		// given
		const terminal = new VirtualTerminal(18, 5);
		const tui = new TUI(terminal);
		const successBg = "\x1b[48;2;10;90;40m";
		const successBgColor = 0x0a5a28;
		const errorBg = "\x1b[48;2;90;20;20m";
		const errorBgColor = 0x5a1414;
		const innerBg = "\x1b[48;2;20;20;120m";
		tui.addChild(new Text(`${innerBg}first`, 0, 0, (text) => `${successBg}${text}\x1b[49m`));
		tui.addChild(new Text("separator", 0, 0));
		tui.addChild(new Text(`${innerBg}second`, 0, 0, (text) => `${errorBg}${text}\x1b[49m`));

		try {
			// when
			tui.start();
			await terminal.waitForRender();

			// then
			const firstPaddingBackground = getCellBackground(terminal, 0, 5);
			const separatorBackground = getCellBackground(terminal, 1, 0);
			const separatorTailBackground = getCellBackground(terminal, 1, 9);
			const secondPaddingBackground = getCellBackground(terminal, 2, 6);
			assert.strictEqual(firstPaddingBackground.color, successBgColor);
			assert.strictEqual(separatorBackground.isDefault, true);
			assert.strictEqual(separatorTailBackground.isDefault, true);
			assert.strictEqual(secondPaddingBackground.color, errorBgColor);
		} finally {
			tui.stop();
		}
	});
});
