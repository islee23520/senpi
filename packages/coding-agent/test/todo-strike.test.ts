import { describe, expect, test } from "vitest";
import {
	hasCompletedTodoTasks,
	partialStrikethrough,
	strikeRevealCount,
	TODO_STRIKE_TOTAL_FRAMES,
} from "../src/modes/interactive/components/todo-strike.ts";

const markerStrike = (text: string): string => `<s>${text}</s>`;

describe("todo strike helpers", () => {
	test("returns undefined when the animation frame is undefined", () => {
		expect(strikeRevealCount("abcdefghijkl", undefined)).toBeUndefined();
	});

	test("holds the strike reveal for the initial frames", () => {
		for (const frame of [0, 1, 2]) {
			expect(strikeRevealCount("abcdefghijkl", frame)).toBe(0);
		}
	});

	test("reveals one character on the first reveal frame", () => {
		expect(strikeRevealCount("abcdefghijkl", 3)).toBe(1);
	});

	test("reveals all characters at the total frame and beyond", () => {
		expect(strikeRevealCount("abcdefghijkl", TODO_STRIKE_TOTAL_FRAMES)).toBe(12);
		expect(strikeRevealCount("abcdefghijkl", TODO_STRIKE_TOTAL_FRAMES + 1)).toBe(12);
	});

	test("returns undefined for empty text after the hold frames", () => {
		expect(strikeRevealCount("", 3)).toBeUndefined();
	});

	test("counts Unicode code points rather than UTF-16 code units", () => {
		expect(strikeRevealCount("ab🎉cd", 8)).toBe(3);
		expect(partialStrikethrough("ab🎉cd", 3, markerStrike)).toBe("<s>ab🎉</s>cd");
	});

	test("applies partial strikethrough at the boundary values", () => {
		expect(partialStrikethrough("abcd", 0, markerStrike)).toBe("abcd");
		expect(partialStrikethrough("abcd", 2, markerStrike)).toBe("<s>ab</s>cd");
		expect(partialStrikethrough("abcd", 4, markerStrike)).toBe("<s>abcd</s>");
	});

	test("recognizes non-empty completed task arrays structurally", () => {
		expect(hasCompletedTodoTasks({ completedTasks: [{ content: "done" }] })).toBe(true);
		expect(hasCompletedTodoTasks({ completedTasks: [] })).toBe(false);
		expect(hasCompletedTodoTasks({})).toBe(false);
		expect(hasCompletedTodoTasks(null)).toBe(false);
		expect(hasCompletedTodoTasks(false)).toBe(false);
		expect(hasCompletedTodoTasks("not details")).toBe(false);
	});
});
