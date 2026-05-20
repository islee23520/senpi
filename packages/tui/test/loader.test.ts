import assert from "node:assert";
import { describe, it } from "node:test";
import { Loader, TUI } from "../src/index.js";
import { VirtualTerminal } from "./virtual-terminal.js";

describe("Loader", () => {
	it("uses a message formatter with elapsed animation time", () => {
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{
				frames: ["•"],
				messageFormatter: (message, animationElapsedMs) => `[${Number.isFinite(animationElapsedMs)}]${message}`,
			},
		);

		loader.stop();

		const renderedLine = loader.render(40)[1];
		assert.ok(renderedLine?.includes("• [true]Working"), `expected formatted loader line, got ${renderedLine}`);
	});

	it("keeps animating formatted messages with a static indicator frame", async () => {
		// Given
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		const formattedMessages: string[] = [];
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{
				frames: ["•"],
				intervalMs: 1_000,
				messageFormatter: (message, animationElapsedMs) => {
					const formatted = `${message}:${animationElapsedMs}`;
					formattedMessages.push(formatted);
					return formatted;
				},
				messageIntervalMs: 5,
			},
		);

		// When
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 25);
		});
		loader.stop();

		// Then
		assert.ok(formattedMessages.length >= 2, `expected repeated message frames, got ${formattedMessages.length}`);
		assert.notEqual(formattedMessages[0], formattedMessages[formattedMessages.length - 1]);
		assert.match((loader.render(40)[1] ?? "").trim(), /^• Working:\d+$/);
	});

	it("formats messages when the indicator is hidden", () => {
		// Given
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{
				frames: [],
				messageFormatter: (message) => `[${message}]`,
			},
		);

		// When
		loader.stop();
		const renderedLine = loader.render(40)[1];

		// Then
		assert.equal(renderedLine?.trim(), "[Working]");
	});
});
