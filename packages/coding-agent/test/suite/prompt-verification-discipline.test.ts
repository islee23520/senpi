import { describe, expect, it } from "vitest";
import {
	buildTestDisciplineSection,
	buildVerificationSection,
	TEST_DISCIPLINE_RULES,
} from "../../src/core/dynamic-prompt/verification.ts";

describe("prompt verification discipline", () => {
	it("models requested test guidance as semantic rules instead of raw prompt snapshots", () => {
		const rulesById = new Map(TEST_DISCIPLINE_RULES.map((rule) => [rule.id, rule]));

		expect(rulesById.get("deterministic-tests")?.concern).toBe("test-determinism");
		expect(rulesById.get("fixed-wait-ban")?.concern).toBe("async-test-orchestration");
		expect(rulesById.get("event-timeout-pattern")?.concern).toBe("async-test-orchestration");
		expect(rulesById.get("mock-contract-integrity")?.concern).toBe("mock-contracts");
		expect(rulesById.get("prompt-behavior-coverage")?.concern).toBe("prompt-tests");
		expect(rulesById.get("single-pass-runner")?.concern).toBe("test-runner");

		for (const rule of TEST_DISCIPLINE_RULES) {
			expect(rule.directive.length).toBeGreaterThan(32);
			expect(rule.directive).not.toMatch(/^do not [a-z ]+$/i);
		}
	});

	it("injects the structured test discipline section into verification guidance", () => {
		expect(buildVerificationSection().includes(buildTestDisciplineSection())).toBe(true);
	});
});
