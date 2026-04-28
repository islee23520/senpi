import { fauxOverflowError } from "@mariozechner/pi-ai";
import { beforeAll, describe, expect, it } from "vitest";
import {
	HIGH_CONFIDENCE_PATTERNS,
	isContextOverflowError,
	isUsageSilentOverflow,
	LOW_CONFIDENCE_PATTERNS,
	MEDIUM_CONFIDENCE_PATTERNS,
} from "../../src/core/extensions/builtin/compaction/overflow-detection.js";

type FauxOverflowProvider = "anthropic" | "openai" | "google" | "bedrock" | "generic";

function errorFromOverflowMessage(provider: FauxOverflowProvider, phrase: string): Error {
	const message = fauxOverflowError(provider, phrase);
	return new Error(message.errorMessage ?? "");
}

describe("isContextOverflowError", () => {
	beforeAll(() => {
		// Anchor the imported tier arrays so the file fails immediately if the
		// T3 placeholder exports are removed. Per-pattern behavior is exercised
		// below via the public API; the array contents themselves are not
		// asserted here so this anchor stays decoupled from T21's eventual
		// pattern population.
		expect(Array.isArray(HIGH_CONFIDENCE_PATTERNS)).toBe(true);
		expect(Array.isArray(MEDIUM_CONFIDENCE_PATTERNS)).toBe(true);
		expect(Array.isArray(LOW_CONFIDENCE_PATTERNS)).toBe(true);
	});

	describe("HIGH_CONFIDENCE tier (single match suffices for confidence 'high')", () => {
		describe("Given an Anthropic / OpenAI error matching /context_length_exceeded/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'high' }", () => {
					const error = errorFromOverflowMessage("openai", "context_length_exceeded: too many tokens");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "high" });
				});
			});
		});

		describe("Given an Anthropic error matching /prompt is too long/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'high' }", () => {
					const error = errorFromOverflowMessage(
						"anthropic",
						"prompt is too long: 250000 tokens > 200000 maximum",
					);
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "high" });
				});
			});
		});

		describe("Given an OpenAI error matching /maximum context length/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'high' }", () => {
					const error = errorFromOverflowMessage("openai", "this model's maximum context length is 4096 tokens");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "high" });
				});
			});
		});

		describe("Given an OpenAI error matching /context length exceeded/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'high' }", () => {
					const error = errorFromOverflowMessage("openai", "context length exceeded by 100 tokens");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "high" });
				});
			});
		});
	});

	describe("MEDIUM_CONFIDENCE tier (requires >= 2 simultaneous matches per plugsuits semantics)", () => {
		describe("Given /token limit exceeded/i paired with another MEDIUM pattern in the same error message", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'medium' }", () => {
					// /token limit exceeded/i AND /exceeds the context window/i both match.
					const error = errorFromOverflowMessage(
						"openai",
						"token limit exceeded; the call exceeds the context window",
					);
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "medium" });
				});
			});
		});

		describe("Given /tokens exceeds the context window/i paired with another MEDIUM pattern in the same error message", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'medium' }", () => {
					// "tokens exceeds the context window" matches both
					// /tokens exceeds the context window/i and /exceeds the context window/i (substring),
					// satisfying the >=2 medium-match rule with a single phrase.
					const error = errorFromOverflowMessage(
						"google",
						"the requested 50000 tokens exceeds the context window of 8192",
					);
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "medium" });
				});
			});
		});

		describe("Given /exceeds the context window/i paired with another MEDIUM pattern in the same error message", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'medium' }", () => {
					// /exceeds the context window/i AND /token limit exceeded/i both match.
					const error = errorFromOverflowMessage(
						"google",
						"this exceeds the context window; token limit exceeded",
					);
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "medium" });
				});
			});
		});

		describe("Given a single MEDIUM pattern matches in isolation (no other MEDIUM pattern matches)", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then confidence is NOT 'medium' (medium tier requires >= 2 simultaneous matches)", () => {
					// Phrase matches MEDIUM[2] /exceeds the context window/i alone,
					// without "tokens" preceding "exceeds" (excludes MEDIUM[1]) and
					// without "token limit exceeded" (excludes MEDIUM[0]). The function
					// therefore falls through to the LOW tier via /context window/i.
					const error = errorFromOverflowMessage("google", "this exceeds the context window");
					const result = isContextOverflowError(error);
					expect(result.confidence).not.toBe("medium");
				});
			});
		});

		describe("Given two distinct MEDIUM patterns match together (and HIGH does not match)", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'medium' }", () => {
					const error = errorFromOverflowMessage(
						"openai",
						"token limit exceeded; tokens exceeds the context window",
					);
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "medium" });
				});
			});
		});
	});

	describe("LOW_CONFIDENCE tier (single match suffices for confidence 'low' when HIGH and MEDIUM do not apply)", () => {
		describe("Given a generic error matching only /context window/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'low' }", () => {
					const error = errorFromOverflowMessage("generic", "the context window is full");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "low" });
				});
			});
		});

		describe("Given a generic error matching only /input too long/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'low' }", () => {
					const error = errorFromOverflowMessage("generic", "input too long for processing");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "low" });
				});
			});
		});

		describe("Given a generic error matching only /input is too long/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'low' }", () => {
					// "input is too long" does NOT match /input too long/i (literal substring),
					// so this exercises LOW[2] in isolation.
					const error = errorFromOverflowMessage("generic", "input is too long");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "low" });
				});
			});
		});

		describe("Given a generic error matching only /token limit/i (not /token limit exceeded/i)", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'low' }", () => {
					// "approaching the token limit soon" matches LOW[3] but not MEDIUM[0]
					// because there is no literal "token limit exceeded" substring.
					const error = errorFromOverflowMessage("openai", "approaching the token limit soon");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "low" });
				});
			});
		});

		describe("Given a generic error matching only /too many tokens/i", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: true, confidence: 'low' }", () => {
					const error = errorFromOverflowMessage("anthropic", "too many tokens in the request body");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "low" });
				});
			});
		});
	});

	describe("Tier ordering (HIGH preempts LOW when both match)", () => {
		describe("Given an error message matching both a HIGH pattern and a LOW pattern", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then HIGH wins and returns { detected: true, confidence: 'high' }", () => {
					const error = errorFromOverflowMessage("openai", "context_length_exceeded; the context window is full");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: true, confidence: "high" });
				});
			});
		});
	});

	describe("Negative cases (errors that must NOT be classified as overflow)", () => {
		describe("Given an OpenAI rate_limit_exceeded error (no overflow keywords)", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: false, confidence: 'low' }", () => {
					const error = errorFromOverflowMessage("openai", "rate_limit_exceeded: please retry later");
					const result = isContextOverflowError(error);
					expect(result).toEqual({ detected: false, confidence: "low" });
				});
			});
		});

		describe("Given an authentication failure (401 Unauthorized or 403 Forbidden)", () => {
			describe("When isContextOverflowError inspects the error message for either phrase", () => {
				it("Then both phrases return { detected: false }", () => {
					const phrases = ["401 Unauthorized: invalid API key", "403 Forbidden: account suspended"];
					for (const phrase of phrases) {
						const error = errorFromOverflowMessage("openai", phrase);
						const result = isContextOverflowError(error);
						expect(result.detected).toBe(false);
					}
				});
			});
		});

		describe("Given a 500 Internal Server Error (no overflow keywords)", () => {
			describe("When isContextOverflowError inspects the error message", () => {
				it("Then returns { detected: false }", () => {
					const error = errorFromOverflowMessage("openai", "500 Internal Server Error: please retry");
					const result = isContextOverflowError(error);
					expect(result.detected).toBe(false);
				});
			});
		});

		describe("Given a non-Error instance (plain object whose 'message' field happens to match an overflow pattern)", () => {
			describe("When isContextOverflowError inspects the value", () => {
				it("Then returns { detected: false, confidence: 'low' } (plugsuits source line 67 short-circuit)", () => {
					const result = isContextOverflowError({ message: "context_length_exceeded" });
					expect(result).toEqual({ detected: false, confidence: "low" });
				});
			});
		});
	});

	describe("Case insensitivity (regex /i flag is honored across cases)", () => {
		describe("Given UPPERCASE / lowercase / MixedCase variants of an overflow phrase", () => {
			describe("When isContextOverflowError inspects each variant", () => {
				it("Then every variant returns the same detection and confidence", () => {
					const variants = ["context_length_exceeded", "CONTEXT_LENGTH_EXCEEDED", "Context_Length_Exceeded"];
					for (const variant of variants) {
						const error = errorFromOverflowMessage("openai", variant);
						const result = isContextOverflowError(error);
						expect(result).toEqual({ detected: true, confidence: "high" });
					}
				});
			});
		});
	});
});

describe("isUsageSilentOverflow", () => {
	describe("Given usage.inputTokens > contextWindow", () => {
		describe("When isUsageSilentOverflow is invoked with the usage and the contextWindow", () => {
			it("Then returns true (silent overflow detected)", () => {
				const result = isUsageSilentOverflow({ inputTokens: 200_000 }, 128_000);
				expect(result).toBe(true);
			});
		});
	});

	describe("Given usage.inputTokens <= contextWindow", () => {
		describe("When isUsageSilentOverflow is invoked with the usage and the contextWindow", () => {
			it("Then returns false (no silent overflow)", () => {
				const result = isUsageSilentOverflow({ inputTokens: 100_000 }, 128_000);
				expect(result).toBe(false);
			});
		});
	});
});
