import { describe, expect, it } from "vitest";
import {
	computeRestorationBudget,
	consumePendingPayload,
	createRestorationTrackerState,
	preparePendingPayload,
	trackToolCall,
} from "../../src/core/extensions/builtin/compaction/restoration-tracker.js";

describe("post-compact restoration tracker", () => {
	describe("Given file and skill tool calls were observed before compaction", () => {
		describe("When session_compact is accepted", () => {
			it("Then a restoration payload is computed but not consumed until before_agent_start", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "src/core/agent-session.ts" } });
				trackToolCall(state, { toolName: "edit", input: { path: "src/core/extensions/runner.ts" } });
				trackToolCall(state, {
					toolName: "apply_patch",
					input: { input: "*** Begin Patch\n*** Update File: test.ts\n@@\n-old\n+new\n*** End Patch" },
				});
				trackToolCall(state, { toolName: "skill", input: { name: "typescript-programmer" } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-1",
					contextWindow: 100_000,
					usageTokens: 50_000,
					reserveTokens: 10_000,
					settings: { restorationMaxTotalTokens: 30_000 },
				});

				// Then
				expect(state.pendingPayload).toBeDefined();
				expect(state.pendingPayload?.content).toContain("src/core/agent-session.ts");
				expect(state.pendingPayload?.content).toContain("src/core/extensions/runner.ts");
				expect(state.pendingPayload?.content).toContain("test.ts");
				expect(state.pendingPayload?.content).toContain("typescript-programmer");
				expect(state.pendingPayload?.content).toContain("reason: manual");
			});
		});
	});

	describe("Given a pending restoration payload exists after session_compact", () => {
		describe("When before_agent_start consumes it twice", () => {
			it("Then the custom message is injected only on the next start", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "src/index.ts" } });
				preparePendingPayload(state, {
					accepted: true,
					reason: "threshold",
					compactionEntryId: "compact-2",
					contextWindow: 80_000,
					usageTokens: null,
					reserveTokens: 8_000,
					settings: { restorationMaxTotalTokens: 20_000 },
				});

				// When
				const first = consumePendingPayload(state);
				const second = consumePendingPayload(state);

				// Then
				expect(first?.customType).toBe("compaction.post-compact-restoration");
				expect(first?.display).toBe(false);
				expect(first?.content).toContain("src/index.ts");
				expect(second).toBeUndefined();
				expect(state.pendingPayload).toBeNull();
			});
		});
	});

	describe("Given dynamic budget inputs where context ratio is the tightest limit", () => {
		describe("When the restoration budget is computed", () => {
			it("Then the budget is min(config.maxTotalTokens, contextWindow*ratio, contextWindow-usage-reserve)", () => {
				// Given
				const options = {
					accepted: true,
					reason: "overflow" as const,
					compactionEntryId: "compact-3",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000, restorationContextRatio: 0.15 },
				};

				// When
				const budget = computeRestorationBudget(options);

				// Then
				expect(budget).toBe(15_000);
			});
		});
	});

	describe("Given dynamic budget inputs where remaining context is the tightest limit", () => {
		describe("When the restoration budget is computed", () => {
			it("Then contextWindow minus usage minus reserve caps the payload", () => {
				// Given
				const options = {
					accepted: true,
					reason: "pre_prompt" as const,
					compactionEntryId: "compact-4",
					contextWindow: 100_000,
					usageTokens: 88_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000, restorationContextRatio: 0.15 },
				};

				// When
				const budget = computeRestorationBudget(options);

				// Then
				expect(budget).toBe(7_000);
			});
		});
	});

	describe("Given a tracked file path already appears in kept post-compaction messages", () => {
		describe("When a restoration payload is prepared with those kept messages", () => {
			it("Then that file is filtered out and not restored", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "kept.ts" } });
				trackToolCall(state, { toolName: "read", input: { path: "lost.ts" } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-kept",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000 },
					keptMessages: [
						{
							role: "assistant",
							api: "faux",
							provider: "faux",
							model: "faux",
							content: [{ type: "text", text: "Already kept context mentions kept.ts explicitly." }],
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							stopReason: "stop",
							timestamp: 0,
						},
					],
				});

				// Then
				expect(state.pendingPayload?.content).not.toContain("kept.ts");
				expect(state.pendingPayload?.content).toContain("lost.ts");
			});
		});
	});

	describe("Given an oversized restoration item", () => {
		describe("When restorationMaxTokensPerItem is smaller than the item", () => {
			it("Then the item content is truncated with a truncation notice", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "skill", input: { name: "x".repeat(400) } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-truncate",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTokensPerItem: 10, restorationMaxTotalTokens: 30_000 },
				});

				// Then
				expect(state.pendingPayload?.content).toContain("[... truncated]");
				expect(state.pendingPayload?.details.items[0]?.tokens).toBeLessThanOrEqual(10);
			});
		});
	});

	describe("Given a restoration payload was already injected after the first compaction", () => {
		describe("When a second compaction happens after a new file is tracked", () => {
			it("Then only newly tracked unrestored items are injected", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "first.ts" } });
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-first",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000 },
				});
				consumePendingPayload(state);
				trackToolCall(state, { toolName: "edit", input: { path: "second.ts" } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-second",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000 },
				});

				// Then
				expect(state.pendingPayload?.content).not.toContain("first.ts");
				expect(state.pendingPayload?.content).toContain("second.ts");
			});
		});
	});

	describe("Given file and skill items are selected for restoration", () => {
		describe("When the restoration message is built", () => {
			it("Then files and skills are wrapped in plural XML sections", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "file.ts" } });
				trackToolCall(state, { toolName: "skill", input: { name: "typescript-programmer" } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-xml",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxTotalTokens: 30_000 },
				});

				// Then
				expect(state.pendingPayload?.content).toContain("<restored-files>");
				expect(state.pendingPayload?.content).toContain("</restored-files>");
				expect(state.pendingPayload?.content).toContain("<restored-skills>");
				expect(state.pendingPayload?.content).toContain("</restored-skills>");
			});
		});
	});

	describe("Given restorationMaxItems is 2 and three tracked items exist", () => {
		describe("When a payload is prepared", () => {
			it("Then only the two highest-priority items are kept", () => {
				// Given
				const state = createRestorationTrackerState();
				trackToolCall(state, { toolName: "read", input: { path: "read-only.ts" } });
				trackToolCall(state, { toolName: "edit", input: { path: "edited.ts" } });
				trackToolCall(state, { toolName: "skill", input: { name: "typescript-programmer" } });

				// When
				preparePendingPayload(state, {
					accepted: true,
					reason: "manual",
					compactionEntryId: "compact-5",
					contextWindow: 100_000,
					usageTokens: 10_000,
					reserveTokens: 5_000,
					settings: { restorationMaxItems: 2, restorationMaxTotalTokens: 30_000 },
				});

				// Then
				expect(state.pendingPayload?.content).toContain("edited.ts");
				expect(state.pendingPayload?.content).toContain("typescript-programmer");
				expect(state.pendingPayload?.content).not.toContain("read-only.ts");
			});
		});
	});
});
