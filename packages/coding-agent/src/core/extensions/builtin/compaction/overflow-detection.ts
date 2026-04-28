export const HIGH_CONFIDENCE_PATTERNS: RegExp[] = [
	/context_length_exceeded/i,
	/prompt is too long/i,
	/maximum context length/i,
	/context length exceeded/i,
];

export const MEDIUM_CONFIDENCE_PATTERNS: RegExp[] = [
	/token limit exceeded/i,
	/tokens exceeds the context window/i,
	/exceeds the context window/i,
];

export const LOW_CONFIDENCE_PATTERNS: RegExp[] = [
	/context window/i,
	/input too long/i,
	/input is too long/i,
	/token limit/i,
	/too many tokens/i,
];

export function isContextOverflowError(error: unknown): { detected: boolean; confidence: "high" | "medium" | "low" } {
	if (!(error instanceof Error)) {
		return { detected: false, confidence: "low" };
	}

	const message = error.message;

	if (HIGH_CONFIDENCE_PATTERNS.some((pattern) => pattern.test(message))) {
		return { detected: true, confidence: "high" };
	}

	const mediumMatches = MEDIUM_CONFIDENCE_PATTERNS.filter((pattern) => pattern.test(message)).length;
	if (mediumMatches >= 2) {
		return { detected: true, confidence: "medium" };
	}

	if (LOW_CONFIDENCE_PATTERNS.some((pattern) => pattern.test(message))) {
		return { detected: true, confidence: "low" };
	}

	return { detected: false, confidence: "low" };
}

export function isUsageSilentOverflow(usage: { inputTokens?: number }, contextWindow: number): boolean {
	const tokens = usage.inputTokens ?? 0;
	return tokens > contextWindow;
}
