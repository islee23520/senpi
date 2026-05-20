import { describe, expect, it } from "vitest";
import {
	parsePatch,
	StreamingPatchParser,
	seekSequence,
} from "../../src/core/extensions/builtin/gpt-apply-patch/index.ts";

describe("gpt apply_patch streaming parser", () => {
	it("streams complete file sections before the end marker", () => {
		const parser = new StreamingPatchParser();

		expect(parser.pushDelta("*** Begin Patch\n*** Add File: src/hello.txt\n+hello\n+wor")).toEqual([
			{ type: "add", filePath: "src/hello.txt", content: "hello\n" },
		]);
		expect(parser.pushDelta("ld\n")).toEqual([{ type: "add", filePath: "src/hello.txt", content: "hello\nworld\n" }]);
	});

	it("matches strict parsing after finish", () => {
		const patch = `*** Begin Patch
*** Add File: docs/release-notes.md
+# Release notes
+
+- Stream apply_patch progress.
*** Update File: src/config.ts
@@ Config
-const interval = 500;
+const interval = 250;
*** Delete File: src/old.ts
*** End Patch`;
		const parser = new StreamingPatchParser();
		for (const character of patch) {
			parser.pushDelta(character);
		}

		expect(parser.finish()).toEqual(parsePatch(patch));
	});

	it("requires the final end marker on finish", () => {
		const parser = new StreamingPatchParser();
		parser.pushDelta("*** Begin Patch\n*** Delete File: stale.txt\n");

		expect(() => parser.finish()).toThrow("*** End Patch");
	});
});

describe("gpt apply_patch seekSequence", () => {
	it("matches Codex exact, rstrip, trim, and impossible-pattern behavior", () => {
		expect(seekSequence(["foo", "bar", "baz"], ["bar", "baz"], 0, false)).toBe(1);
		expect(seekSequence(["foo   ", "bar\t\t"], ["foo", "bar"], 0, false)).toBe(0);
		expect(seekSequence(["    foo   ", "   bar\t"], ["foo", "bar"], 0, false)).toBe(0);
		expect(seekSequence(["just one line"], ["too", "many", "lines"], 0, false)).toBeUndefined();
	});

	it("normalizes typographic punctuation and odd spaces", () => {
		expect(seekSequence(["say “hello” — now"], ['say "hello" - now'], 0, false)).toBe(0);
		expect(seekSequence(["hello\u00A0world"], ["hello world"], 0, false)).toBe(0);
	});

	it("starts EOF searches at the last possible match", () => {
		expect(seekSequence(["target", "middle", "target"], ["target"], 0, true)).toBe(2);
	});
});
