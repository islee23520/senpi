import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerFauxProvider } from "@mariozechner/pi-ai";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	createDegradationMonitorState,
	handleMessageEnd,
} from "../../src/core/extensions/builtin/compaction/degradation-monitor.js";
import { migrateSessionEntries, parseSessionEntries, type SessionEntry } from "../../src/core/session-manager.js";

const POST_COMPACTION_MONITOR_COUNT = 5;
const POST_COMPACTION_NO_TEXT_THRESHOLD = 3;
const RECOVERY_INSTRUCTIONS = "RECOVERY: prior compaction caused degraded responses; rebuild context";
const RECOVERY_NOTIFICATION = "Detected repeated no-text assistant responses; retried compaction recovery.";

type AssistantContentPart =
	| { type: "text"; text: string }
	| { type: "step-start"; id: string }
	| { type: "step-finish"; id: string };

type AssistantMessageEvent = {
	message: {
		role: "assistant";
		content: AssistantContentPart[];
	};
};

type CompactCall = {
	reason?: string;
	customInstructions?: string;
};

type MonitorContext = {
	compact: (options: { customInstructions: string }) => Promise<{ reason: "extension" }>;
	notify: (message: string) => void;
	compactCalls: CompactCall[];
	notifications: string[];
};

type MonitorState = ReturnType<typeof createDegradationMonitorState> & {
	postCompactionTurnsRemaining: number;
	noTextCounter: number;
	recoveryTriggeredThisCycle: boolean;
	recoveryAttempts: number;
};

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

let degradationFixtureEntries: SessionEntry[] = [];

beforeAll(() => {
	const fixturePath = join(
		__dirname,
		"..",
		"fixtures",
		"compaction",
		"degradation-monitor",
		"post-compact-three-no-text.jsonl",
	);
	const content = readFileSync(fixturePath, "utf-8");
	const entries = parseSessionEntries(content);
	migrateSessionEntries(entries);
	degradationFixtureEntries = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
});

function createPostCompactionState(overrides?: Partial<MonitorState>): MonitorState {
	return Object.assign(createDegradationMonitorState(), {
		postCompactionTurnsRemaining: POST_COMPACTION_MONITOR_COUNT,
		noTextCounter: 0,
		recoveryTriggeredThisCycle: false,
		recoveryAttempts: 0,
		...overrides,
	});
}

function createMonitorContext(): MonitorContext {
	const compactCalls: CompactCall[] = [];
	const notifications: string[] = [];

	return {
		compactCalls,
		notifications,
		compact: async (options) => {
			compactCalls.push({ reason: "extension", customInstructions: options.customInstructions });
			return { reason: "extension" };
		},
		notify: (message) => {
			notifications.push(message);
		},
	};
}

function assistantMessageWithText(): AssistantMessageEvent {
	return {
		message: {
			role: "assistant",
			content: [{ type: "text", text: "Continuing after compaction." }],
		},
	};
}

function assistantMessageWithoutText(): AssistantMessageEvent {
	return {
		message: {
			role: "assistant",
			content: [
				{ type: "step-start", id: "step-1" },
				{ type: "step-finish", id: "step-1" },
			],
		},
	};
}

async function applyMessageEnd(
	state: MonitorState,
	event: AssistantMessageEvent,
	context: MonitorContext,
): Promise<void> {
	await Promise.resolve(Reflect.apply(handleMessageEnd, undefined, [state, event, context]));
}

describe("post-compaction degradation monitor", () => {
	describe("Given compaction completed", () => {
		describe("When the 1st post-compaction assistant message has text", () => {
			it("Then the no-text counter is not incremented", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState();
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithText(), context);

				expect(state.noTextCounter).toBe(0);
				expect(context.compactCalls).toHaveLength(0);
			});
		});
	});

	describe("Given compaction completed", () => {
		describe("When the 1st post-compaction assistant message has zero text with only step-start and step-finish", () => {
			it("Then the no-text counter equals 1", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState();
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithoutText(), context);

				expect(degradationFixtureEntries.some((entry) => entry.type === "compaction")).toBe(true);
				expect(state.noTextCounter).toBe(1);
				expect(context.compactCalls).toHaveLength(0);
			});
		});
	});

	describe("Given the no-text counter is 2", () => {
		describe("When the 3rd no-text assistant message arrives", () => {
			it("Then recovery compaction is triggered via ctx.compact with reason extension and RECOVERY instructions", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState({ noTextCounter: POST_COMPACTION_NO_TEXT_THRESHOLD - 1 });
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithoutText(), context);

				expect(context.compactCalls).toEqual([{ reason: "extension", customInstructions: RECOVERY_INSTRUCTIONS }]);
				expect(state.recoveryTriggeredThisCycle).toBe(true);
			});
		});
	});

	describe("Given the no-text counter is 2", () => {
		describe("When the 3rd assistant message has text", () => {
			it("Then the no-text counter resets to 0", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState({ noTextCounter: POST_COMPACTION_NO_TEXT_THRESHOLD - 1 });
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithText(), context);

				expect(state.noTextCounter).toBe(0);
				expect(context.compactCalls).toHaveLength(0);
			});
		});
	});

	describe("Given recovery compaction is triggered", () => {
		describe("When it completes", () => {
			it("Then the counter resets to 0 and the exact recovery notification is emitted", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState({ noTextCounter: POST_COMPACTION_NO_TEXT_THRESHOLD - 1 });
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithoutText(), context);

				expect(state.noTextCounter).toBe(0);
				expect(context.notifications).toContain(RECOVERY_NOTIFICATION);
			});
		});
	});

	describe("Given recovery compaction also fails with 3 more no-text messages after recovery", () => {
		describe("When the 6th no-text message arrives", () => {
			it("Then no infinite recursion occurs because the recovery cap allows max 1 recovery per breaker cycle", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState({
					noTextCounter: POST_COMPACTION_NO_TEXT_THRESHOLD - 1,
					recoveryAttempts: 1,
					recoveryTriggeredThisCycle: true,
				});
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithoutText(), context);

				expect(context.compactCalls).toHaveLength(0);
				expect(state.recoveryAttempts).toBe(1);
			});
		});
	});

	describe("Given the session is not in the 5 turns post-compaction window", () => {
		describe("When a no-text assistant message arrives on turn 6 or later", () => {
			it("Then the no-text counter does not track", async () => {
				const registration = registerFauxProvider();
				registrations.push(registration);
				const state = createPostCompactionState({ postCompactionTurnsRemaining: 0 });
				const context = createMonitorContext();

				await applyMessageEnd(state, assistantMessageWithoutText(), context);

				expect(state.noTextCounter).toBe(0);
				expect(context.compactCalls).toHaveLength(0);
			});
		});
	});
});
