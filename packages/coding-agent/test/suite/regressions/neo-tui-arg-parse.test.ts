/**
 * Regression: `--neo` flag must round-trip through `parseArgs` cleanly and
 * coexist with the rest of the senpi CLI surface.
 *
 * The flag dispatch into the Rust binary lives in a later wave; this test
 * only locks the arg-parser contract so future renames or accidental
 * removals fail loudly.
 */

import { describe, expect, test } from "vitest";
import { parseArgs } from "../../../src/cli/args.ts";

describe("--neo flag", () => {
	test("absent by default", () => {
		const parsed = parseArgs([]);
		expect(parsed.neo).toBeUndefined();
	});

	test("--neo sets neo=true", () => {
		const parsed = parseArgs(["--neo"]);
		expect(parsed.neo).toBe(true);
	});

	test("--neo coexists with a positional message", () => {
		const parsed = parseArgs(["--neo", "hello"]);
		expect(parsed.neo).toBe(true);
		expect(parsed.messages).toEqual(["hello"]);
	});

	test("--neo coexists with --provider and --model", () => {
		const parsed = parseArgs(["--neo", "--provider", "anthropic", "--model", "claude-opus-4-7"]);
		expect(parsed.neo).toBe(true);
		expect(parsed.provider).toBe("anthropic");
		expect(parsed.model).toBe("claude-opus-4-7");
	});

	test("--neo does not steal a following non-flag arg", () => {
		const parsed = parseArgs(["--neo", "implement the parser"]);
		expect(parsed.neo).toBe(true);
		expect(parsed.messages).toEqual(["implement the parser"]);
	});

	test("--neo does not appear in unknownFlags", () => {
		const parsed = parseArgs(["--neo"]);
		expect(parsed.unknownFlags.has("neo")).toBe(false);
	});
});
