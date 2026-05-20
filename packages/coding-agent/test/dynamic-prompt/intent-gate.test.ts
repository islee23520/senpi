import { describe, expect, test } from "vitest";
import { buildIntentGate } from "../../src/core/dynamic-prompt/intent-gate.ts";
import type { AvailableTool } from "../../src/core/dynamic-prompt/types.ts";

describe("buildIntentGate", () => {
	test("includes intent verbalization table", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Intent");
		expect(result).toContain("Surface Form");
		expect(result).toContain("True Intent");
	});

	test("includes request classification steps", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Trivial");
		expect(result).toContain("Explicit");
		expect(result).toContain("Exploratory");
		expect(result).toContain("Open-ended");
		expect(result).toContain("Ambiguous");
	});

	test("includes context-completion gate", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Context-Completion Gate");
	});

	test("includes turn-local intent reset", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("Turn-Local Intent Reset");
	});

	test("adds search trigger when search tools are available", () => {
		const tools: AvailableTool[] = [{ name: "grep", category: "search" }];
		const result = buildIntentGate({ tools });

		expect(result).toContain("grep");
	});

	test("forces intent verbalization with the routing line", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("I read this as");
		expect(result).toContain("The routing line is required");
		expect(result).not.toContain("Keep the routing decision internal");
		expect(result).not.toContain("Do not expose classification labels");
	});

	test("includes routing map with surface form to approach mapping", () => {
		const result = buildIntentGate({ tools: [] });

		expect(result).toContain("explain");
		expect(result).toContain("implement");
		expect(result).toContain("error");
		expect(result).toContain("refactor");
	});

	test("includes search triggers when search tools present", () => {
		const tools: AvailableTool[] = [
			{ name: "grep", category: "search" },
			{ name: "read", category: "other" },
		];
		const result = buildIntentGate({ tools });

		expect(result).toContain("grep");
	});
});
