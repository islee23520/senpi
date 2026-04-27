import type { AgentMessage, AgentToolResult } from "@mariozechner/pi-agent-core";
import { complete, type Message, type TextContent } from "@mariozechner/pi-ai";
import {
	DEFAULT_COMPACTION_SETTINGS,
	estimateContextTokens,
	serializeConversation,
} from "../../../compaction/index.js";
import { convertToLlm } from "../../../messages.js";
import type { CompactionEntry } from "../../../session-manager.js";
import type { ExtensionAPI, ExtensionContext } from "../../types.js";
import * as checkpointState from "./checkpoint-state.js";
import * as breaker from "./circuit-breaker.js";
import {
	createDegradationMonitorState,
	handleMessageEnd,
	handleTurnEnd,
	RECOVERY_INSTRUCTIONS,
	resetOnSessionCompact,
} from "./degradation-monitor.js";
import * as overflow from "./overflow-detection.js";
import * as cap from "./per-turn-cap.js";
import * as policy from "./policy.js";
import { buildPrompt, type MergedCompactionPromptVariant } from "./prompts.js";
import { type CompactionExtensionState, createInitialState, resetTurnCounter } from "./state.js";
import * as todoBridge from "./todo-bridge.js";
import { repairOrphanedToolResults } from "./tool-pair-repair.js";
import * as truncation from "./tool-truncation.js";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_BUDGET_RATIO = 0.6;
const MAX_SUMMARY_TOKENS = 8192;
const SUMMARY_SCHEMA = "senpi.compaction.summary.v1";

function approxTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function getSummaryText(message: Message): string {
	const content = Array.isArray(message.content)
		? message.content
		: [{ type: "text" as const, text: message.content }];
	return content
		.filter((content): content is TextContent => content.type === "text")
		.map((content) => content.text)
		.join("\n")
		.trim();
}

function isMonitorableMessageEvent(event: { message: AgentMessage }): event is {
	message: AgentMessage & { content: Array<{ type: string; text?: string }> };
} {
	return "content" in event.message && Array.isArray(event.message.content);
}

function getPromptVariant(event: {
	reason: string;
	preparation: { previousSummary?: string; isSplitTurn: boolean };
}): MergedCompactionPromptVariant {
	if (event.reason === "branch") return "branch";
	if (event.preparation.previousSummary) return "update";
	if (event.preparation.isSplitTurn) return "turn_prefix";
	return "default";
}

function pruneToolResults(messages: AgentMessage[], contextWindow: number): AgentMessage[] {
	const toolResults = messages
		.filter((message) => message.role === "toolResult")
		.map((message): AgentToolResult<undefined> => ({ content: message.content, details: undefined }));
	if (toolResults.length === 0) return messages;

	const prunedResults = truncation.prePruneToolOutputsToBudget(toolResults, contextWindow * COMPACTION_BUDGET_RATIO);
	let resultIndex = 0;
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		const pruned = prunedResults[resultIndex];
		resultIndex++;
		return pruned ? { ...message, content: pruned.content } : message;
	});
}

function truncateContextMessages(messages: AgentMessage[]): AgentMessage[] {
	const toolResults = messages
		.filter((message) => message.role === "toolResult")
		.map((message): AgentToolResult<undefined> => ({ content: message.content, details: undefined }));
	if (toolResults.length === 0) return messages;

	const truncatedResults = truncation.truncateOversizedToolResults(toolResults);
	let resultIndex = 0;
	return messages.map((message) => {
		if (message.role !== "toolResult") return message;
		const truncated = truncatedResults[resultIndex];
		resultIndex++;
		return truncated ? { ...message, content: truncated.content } : message;
	});
}

function updateLastYield(state: CompactionExtensionState, entry: CompactionEntry): CompactionExtensionState {
	const savedTokens = Math.max(0, entry.tokensBefore - approxTokens(entry.summary));
	return { ...state, lastYield: { savedTokens, tokensBefore: entry.tokensBefore } };
}

function recentCheckpoint(ctx: ExtensionContext): checkpointState.AgentCheckpoint | null {
	const checkpoint = checkpointState.getLatestCheckpoint(ctx);
	if (!checkpoint?.timestamp) return null;
	return Date.now() - checkpoint.timestamp <= 60_000 ? checkpoint : null;
}

export default function compactionExtension(pi: ExtensionAPI): void {
	let state: CompactionExtensionState = createInitialState();
	const degradationState = createDegradationMonitorState();

	pi.on("session_before_compact", async (event, ctx) => {
		if (cap.shouldRejectByCap(state, { reason: event.reason }).cancel) return { cancel: true };
		if (breaker.isTripped(state, Date.now()) && !breaker.shouldBypass(state, { reason: event.reason }))
			return { cancel: true };

		checkpointState.persistCheckpoint(pi, checkpointState.captureAgentCheckpoint(pi, ctx));
		todoBridge.captureTodoSnapshot(pi, ctx);

		const model = ctx.model;
		if (!model) return undefined;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok || !auth.apiKey) return undefined;

		const contextWindow = ctx.getContextUsage()?.contextWindow ?? model.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
		const messages = pruneToolResults(
			[...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages],
			contextWindow,
		);
		const promptVariant = getPromptVariant(event);
		const prompt = buildPrompt({
			variant: promptVariant,
			previousSummary: event.preparation.previousSummary,
			customInstructions: event.customInstructions,
		});
		const conversationText = serializeConversation(convertToLlm(messages));
		const response = await complete(
			model,
			{
				systemPrompt: prompt.system,
				messages: [
					{
						role: "user",
						content: [
							{ type: "text", text: `${prompt.user}\n\n<conversation>\n${conversationText}\n</conversation>` },
						],
						timestamp: Date.now(),
					},
				],
			},
			{
				apiKey: auth.apiKey,
				headers: auth.headers,
				extraBody: auth.extraBody,
				maxTokens: MAX_SUMMARY_TOKENS,
				signal: event.signal,
			},
		);
		const summary = getSummaryText(response);
		if (!summary) return undefined;

		const tokenEstimate = estimateContextTokens(convertToLlm(messages)).tokens + approxTokens(summary);
		if (tokenEstimate > contextWindow * COMPACTION_BUDGET_RATIO) return { cancel: true };

		return {
			compaction: {
				summary,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: { schema: SUMMARY_SCHEMA, promptVariant, tokenEstimate },
			},
		};
	});

	pi.on("session_compact", async (event, ctx) => {
		if (event.accepted) {
			state = cap.incrementAccepted(state);
			state = breaker.recordSuccess(state);
			state = updateLastYield(state, event.compactionEntry);
			resetOnSessionCompact(degradationState);
			todoBridge.restoreTodosIfMissing(pi, ctx);
			return;
		}
		state = breaker.recordFailure(state, Date.now(), { route: event.reason });
		ctx.ui.notify(`Compaction rejected: ${event.rejectionCause ?? "unknown"}`, "warning");
	});

	pi.on("before_agent_start", async (event, ctx) => {
		let systemPrompt = event.systemPrompt;
		const checkpoint = recentCheckpoint(ctx);
		if (checkpoint) systemPrompt = checkpointState.injectRestorationDirective(systemPrompt, checkpoint);

		const usage = ctx.getContextUsage();
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
		if (
			usage &&
			policy.shouldTriggerCompaction(usage, contextWindow, DEFAULT_COMPACTION_SETTINGS, state.lastYield ?? undefined)
		) {
			ctx.compact({ customInstructions: "Proactively compact before the next agent turn." });
		}

		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});

	pi.on("context", (event) => {
		const truncatedMessages = truncateContextMessages(event.messages);
		return { messages: repairOrphanedToolResults(convertToLlm(truncatedMessages)) };
	});

	pi.on("turn_end", async (_event, ctx) => {
		handleTurnEnd(degradationState);
		if (degradationState.recoveryTriggeredThisCycle) return;
		if (state.lastYield && state.lastYield.savedTokens <= 0)
			ctx.compact({ customInstructions: RECOVERY_INSTRUCTIONS });
	});

	pi.on("agent_end", () => {
		state = resetTurnCounter(state, "");
	});

	pi.on("message_end", async (event, ctx) => {
		if (isMonitorableMessageEvent(event)) {
			await handleMessageEnd(degradationState, event, {
				compact: async (options) => {
					ctx.compact(options);
					return { reason: "extension" };
				},
				notify: (message) => ctx.ui.notify(message, "warning"),
			});
		}
		if (event.message.role === "assistant" && event.message.stopReason === "error") {
			const detected = overflow.isContextOverflowError(new Error(event.message.errorMessage ?? ""));
			if (detected.detected)
				ctx.compact({ customInstructions: `RECOVERY: context overflow detected (${detected.confidence})` });
		}
	});

	pi.on("tool_result", (event) => {
		const [truncated] = truncation.truncateOversizedToolResults([{ content: event.content, details: event.details }]);
		return truncated ? { content: truncated.content, details: event.details, isError: event.isError } : undefined;
	});
}
