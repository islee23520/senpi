import assert from "node:assert";
import { describe, it } from "node:test";
import { Loader, TUI } from "../src/index.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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

	it("keeps animating formatted indicators with a static indicator frame", async () => {
		// Given
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		const formattedIndicators: string[] = [];
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{
				frames: ["•"],
				intervalMs: 1_000,
				indicatorFormatter: (frame, animationElapsedMs) => {
					const formatted = `${frame}:${animationElapsedMs}`;
					formattedIndicators.push(formatted);
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
		assert.ok(
			formattedIndicators.length >= 2,
			`expected repeated indicator frames, got ${formattedIndicators.length}`,
		);
		assert.notEqual(formattedIndicators[0], formattedIndicators[formattedIndicators.length - 1]);
		assert.match((loader.render(40)[1] ?? "").trim(), /^•:\d+ Working$/);
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

	it("does not request renders when the displayed loader text is unchanged", () => {
		// Given
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		let renderRequests = 0;
		tui.requestRender = () => {
			renderRequests++;
		};
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{ frames: ["•"] },
		);
		const initialRenderRequests = renderRequests;

		// When
		loader.setMessage("Working");
		loader.stop();

		// Then
		assert.equal(renderRequests, initialRenderRequests);
	});

	it("unrefs loader animation timers", () => {
		// Given
		const terminal = new VirtualTerminal(40, 4);
		const tui = new TUI(terminal);
		const loader = new Loader(
			tui,
			(text) => text,
			(text) => text,
			"Working",
			{
				frames: ["1", "2"],
				messageFormatter: (message) => message,
				messageIntervalMs: 5,
			},
		);

		// When
		const indicatorInterval = Reflect.get(loader, "indicatorIntervalId");
		const messageInterval = Reflect.get(loader, "messageIntervalId");
		loader.stop();

		// Then
		assert.equal(typeof indicatorInterval?.hasRef, "function");
		assert.equal(typeof messageInterval?.hasRef, "function");
		assert.equal(indicatorInterval.hasRef(), false);
		assert.equal(messageInterval.hasRef(), false);
	});
});
