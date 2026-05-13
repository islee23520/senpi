import { type AssistantMessage, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateContextTokens } from "../../src/core/compaction/index.js";
import { SANEPI_SYSTEM_PREFIX } from "../../src/core/extensions/builtin/system-messages.js";
import { createHarness, type Harness } from "./harness.js";

const BACKGROUND_REMINDER_TEXT = `${SANEPI_SYSTEM_PREFIX}
<system-reminder>
Use background_output(task_id="bg_123")
</system-reminder>`;

type CheckCompaction = (assistantMessage: AssistantMessage, skipAbortedCheck?: boolean) => Promise<void>;
type RunAutoCompaction = (reason: "overflow" | "threshold", willRetry: boolean) => Promise<void>;

function getCheckCompaction(session: Harness["session"]): CheckCompaction {
	const value = Reflect.get(session, "_checkCompaction");
	if (typeof value !== "function") {
		throw new Error("AgentSession._checkCompaction is not available for characterization tests");
	}
	return value;
}

function getRunAutoCompaction(session: Harness["session"]): RunAutoCompaction {
	const value = Reflect.get(session, "_runAutoCompaction");
	if (typeof value !== "function") {
		throw new Error("AgentSession._runAutoCompaction is not available for characterization tests");
	}
	return value;
}

async function checkCompaction(
	session: Harness["session"],
	assistantMessage: AssistantMessage,
	skipAbortedCheck?: boolean,
): Promise<void> {
	await getCheckCompaction(session).call(session, assistantMessage, skipAbortedCheck);
}

async function runAutoCompaction(
	session: Harness["session"],
	reason: "overflow" | "threshold",
	willRetry: boolean,
): Promise<void> {
	await getRunAutoCompaction(session).call(session, reason, willRetry);
}

function stubRunAutoCompaction(session: Harness["session"]) {
	const stub = vi.fn(async (_reason: "overflow" | "threshold", _willRetry: boolean): Promise<void> => {});
	Reflect.set(session, "_runAutoCompaction", stub);
	return stub;
}

function createUsage(totalTokens: number) {
	return {
		input: totalTokens,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createAssistant(
	harness: Harness,
	options: {
		text?: string;
		stopReason?: AssistantMessage["stopReason"];
		errorMessage?: string;
		totalTokens?: number;
		timestamp?: number;
	},
): AssistantMessage {
	const model = harness.getModel();
	return {
		...fauxAssistantMessage(options.text ?? "", {
			stopReason: options.stopReason,
			errorMessage: options.errorMessage,
			timestamp: options.timestamp,
		}),
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: createUsage(options.totalTokens ?? 0),
	};
}

describe("AgentSession compaction characterization", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("manually compacts using an extension-provided summary", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "summary from extension",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: { source: "extension" },
						},
					}));
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one");
		await harness.session.prompt("two");

		const result = await harness.session.compact();
		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");

		expect(result.summary).toBe("summary from extension");
		expect(compactionEntries).toHaveLength(1);
		expect(harness.session.messages[0]?.role).toBe("compactionSummary");
	});

	it("manual session.compact excludes background task reminders from preparation and token estimates", async () => {
		// given
		const userText = "Investigate why /compact is broken. ".repeat(120).trim();
		const assistantText = "I am checking the compaction path. ".repeat(120).trim();
		const trailingUserText = "Port the fix with tests. ".repeat(120).trim();
		const captured: {
			firstKeptEntryId?: string;
			tokensBefore?: number;
		} = {};

		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 20 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						captured.firstKeptEntryId = event.preparation.firstKeptEntryId;
						captured.tokensBefore = event.preparation.tokensBefore;

						return {
							compaction: {
								summary: "filtered manual compaction summary",
								firstKeptEntryId: event.preparation.firstKeptEntryId,
								tokensBefore: event.preparation.tokensBefore,
							},
						};
					});
				},
			],
		});

		harnesses.push(harness);

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: userText }],
			timestamp: Date.now() - 2_000,
		});
		const assistantMessage = createAssistant(harness, {
			text: assistantText,
			stopReason: "stop",
			totalTokens: 9_000,
			timestamp: Date.now() - 1_000,
		});
		const trailingUserMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: trailingUserText }],
			timestamp: Date.now(),
		};

		harness.sessionManager.appendMessage(assistantMessage);
		harness.sessionManager.appendCustomMessageEntry("background-task.complete", BACKGROUND_REMINDER_TEXT, true);
		const reminderEntryId = harness.sessionManager.getEntries()[harness.sessionManager.getEntries().length - 1]?.id;
		harness.sessionManager.appendMessage({
			...trailingUserMessage,
		});

		// when
		await harness.session.compact();

		// then
		expect(captured.firstKeptEntryId).not.toBe(reminderEntryId);
		expect(captured.firstKeptEntryId).toBeDefined();
		expect(captured.firstKeptEntryId).not.toBeUndefined();
		expect(captured.tokensBefore).toBe(
			estimateContextTokens([
				{ role: "user", content: [{ type: "text", text: userText }], timestamp: Date.now() - 2_000 },
				assistantMessage,
				trailingUserMessage,
			]).tokens,
		);
	});

	it("throws when compacting without a model", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		Reflect.set(harness.session.agent.state, "model", undefined);

		await expect(harness.session.compact()).rejects.toThrow("No model selected");
	});

	it("throws when manually compacting a session that fits within keepRecentTokens", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);

		await harness.session.prompt("hi");
		await harness.session.prompt("who are you");

		// when / then
		await expect(harness.session.compact()).rejects.toThrow("Nothing to compact (session too small)");
		const compactionEntries = harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction");
		expect(compactionEntries).toHaveLength(0);
	});

	it("throws when compacting without configured auth", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			withConfiguredAuth: false,
		});
		harnesses.push(harness);

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "first user" }],
			timestamp: Date.now() - 2000,
		});
		harness.sessionManager.appendMessage(createAssistant(harness, { text: "first assistant", totalTokens: 100 }));
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "second user" }],
			timestamp: Date.now(),
		});

		await expect(harness.session.compact()).rejects.toThrow(`No API key found for ${harness.getModel().provider}.`);
	});

	it("cancels in-progress manual compaction when abortCompaction is called", async () => {
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => {
						return await new Promise<{ cancel: true }>((resolve) => {
							event.signal.addEventListener("abort", () => resolve({ cancel: true }), { once: true });
						});
					});
				},
			],
		});
		harnesses.push(harness);

		await harness.session.prompt("one");
		await harness.session.prompt("two");

		const compactPromise = harness.session.compact();
		await new Promise((resolve) => setTimeout(resolve, 0));
		harness.session.abortCompaction();

		await expect(compactPromise).rejects.toThrow("Compaction cancelled");
	});

	it("resumes after threshold compaction when only agent-level queued messages exist", async () => {
		vi.useFakeTimers();
		const harness = await createHarness({
			settings: { compaction: { keepRecentTokens: 1 } },
			extensionFactories: [
				(pi) => {
					pi.on("session_before_compact", async (event) => ({
						compaction: {
							summary: "auto compacted",
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
							details: {},
						},
					}));
				},
			],
		});
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
		await harness.session.prompt("first");
		await harness.session.prompt("second");

		harness.session.agent.followUp({
			role: "custom",
			customType: "test",
			content: [{ type: "text", text: "queued custom" }],
			display: false,
			timestamp: Date.now(),
		});

		const continueSpy = vi.spyOn(harness.session.agent, "continue").mockResolvedValue();

		await runAutoCompaction(harness.session, "threshold", false);
		await vi.advanceTimersByTimeAsync(100);

		expect(continueSpy).toHaveBeenCalledTimes(1);
	});

	it("does not retry overflow recovery more than once", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const overflowMessage = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "prompt is too long",
			timestamp: Date.now(),
		});
		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);
		const compactionErrors: string[] = [];
		harness.session.subscribe((event) => {
			if (event.type === "compaction_end" && event.errorMessage) {
				compactionErrors.push(event.errorMessage);
			}
		});

		await checkCompaction(harness.session, overflowMessage);
		await checkCompaction(harness.session, { ...overflowMessage, timestamp: Date.now() + 1 });

		expect(runAutoCompactionSpy).toHaveBeenCalledTimes(1);
		expect(compactionErrors).toContain(
			"Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.",
		);
	});

	it("auto-retries overflow recovery when a provider alias differs but current context is still near the limit", async () => {
		const harness = await createHarness({
			api: "openai-codex-responses",
			provider: "openai-codex",
			models: [
				{
					id: "gpt-5.5",
					contextWindow: 272_000,
				},
			],
			settings: { compaction: { enabled: true, reserveTokens: 16_384 } },
		});
		harnesses.push(harness);
		const successfulAssistant = {
			...createAssistant(harness, {
				stopReason: "stop",
				totalTokens: 260_000,
				timestamp: Date.now() - 1_000,
			}),
			provider: "openai",
			model: "gpt-5.5",
		};
		const overflowMessage = {
			...createAssistant(harness, {
				stopReason: "error",
				errorMessage:
					"Your input exceeds the context window of this model. Please adjust your input and try again.",
				timestamp: Date.now(),
			}),
			provider: "openai",
			model: "gpt-5.5",
		};
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "initial work" }], timestamp: Date.now() - 2_000 },
			successfulAssistant,
			{ role: "user", content: [{ type: "text", text: "continue" }], timestamp: Date.now() - 500 },
			overflowMessage,
		];

		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);

		await checkCompaction(harness.session, overflowMessage);

		expect(runAutoCompactionSpy).toHaveBeenCalledWith("overflow", true);
	});

	it("ignores stale pre-compaction assistant usage on pre-prompt checks", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const staleTimestamp = Date.now() - 10_000;
		const staleAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 610_000,
			timestamp: staleTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: staleTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(staleAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			staleAssistant.usage.totalTokens,
			undefined,
			false,
		);
		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "after compaction" }],
			timestamp: Date.now(),
		});

		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);

		await checkCompaction(harness.session, staleAssistant, false);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("triggers threshold compaction for error messages using the last successful usage", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const successfulAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: Date.now(),
		});
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now() + 1000,
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			successfulAssistant,
			{ role: "user", content: [{ type: "text", text: "retry" }], timestamp: Date.now() + 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);

		await checkCompaction(harness.session, errorAssistant);

		expect(runAutoCompactionSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("ignores background task reminders when estimating threshold compaction for error messages", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);
		const successfulAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: Date.now(),
		});
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now() + 1_000,
		});

		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1_000 },
			successfulAssistant,
			{
				role: "custom",
				customType: "background-task.complete",
				content: BACKGROUND_REMINDER_TEXT,
				display: true,
				timestamp: Date.now() - 500,
			},
			errorAssistant,
		];

		const estimateSpy = stubRunAutoCompaction(harness.session);

		// when
		await checkCompaction(harness.session, errorAssistant);

		// then
		expect(estimateSpy).toHaveBeenCalledWith("threshold", false);
	});

	it("getContextUsage excludes background task reminders from token estimates", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);
		const assistant = createAssistant(harness, {
			text: "Compaction context is large.",
			stopReason: "stop",
			totalTokens: 4_000,
			timestamp: Date.now() - 1_000,
		});
		const trailingUser = {
			role: "user" as const,
			content: [{ type: "text" as const, text: "Continue with the fix." }],
			timestamp: Date.now(),
		};

		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "Start the repair." }], timestamp: Date.now() - 2_000 },
			assistant,
			{
				role: "custom",
				customType: "background-task.complete",
				content: BACKGROUND_REMINDER_TEXT,
				display: true,
				timestamp: Date.now() - 500,
			},
			trailingUser,
		];

		// when
		const contextUsage = harness.session.getContextUsage();

		// then
		expect(contextUsage?.tokens).toBe(
			estimateContextTokens([
				{ role: "user", content: [{ type: "text", text: "Start the repair." }], timestamp: Date.now() - 2_000 },
				assistant,
				trailingUser,
			]).tokens,
		);
	});

	it("does not trigger threshold compaction for error messages when no prior usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "hello" }], timestamp: Date.now() - 1000 },
			errorAssistant,
		];

		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);

		await checkCompaction(harness.session, errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("does not trigger threshold compaction when only kept pre-compaction usage exists", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		const preCompactionTimestamp = Date.now() - 10_000;
		const keptAssistant = createAssistant(harness, {
			stopReason: "stop",
			totalTokens: 190_000,
			timestamp: preCompactionTimestamp,
		});

		harness.sessionManager.appendMessage({
			role: "user",
			content: [{ type: "text", text: "before compaction" }],
			timestamp: preCompactionTimestamp - 1000,
		});
		harness.sessionManager.appendMessage(keptAssistant);
		const firstKeptEntryId = harness.sessionManager.getEntries()[0]!.id;
		harness.sessionManager.appendCompaction(
			"summary",
			firstKeptEntryId,
			keptAssistant.usage.totalTokens,
			undefined,
			false,
		);

		const errorAssistant = createAssistant(harness, {
			stopReason: "error",
			errorMessage: "529 overloaded",
			timestamp: Date.now(),
		});
		harness.session.agent.state.messages = [
			{ role: "user", content: [{ type: "text", text: "kept user" }], timestamp: preCompactionTimestamp - 1000 },
			keptAssistant,
			{ role: "user", content: [{ type: "text", text: "new prompt" }], timestamp: Date.now() - 500 },
			errorAssistant,
		];

		const runAutoCompactionSpy = stubRunAutoCompaction(harness.session);

		await checkCompaction(harness.session, errorAssistant);

		expect(runAutoCompactionSpy).not.toHaveBeenCalled();
	});

	it("does not trigger threshold compaction below the threshold or when disabled", async () => {
		const belowThresholdHarness = await createHarness({
			settings: { compaction: { enabled: true, reserveTokens: 1000 } },
			models: [{ id: "faux-1", contextWindow: 200_000 }],
		});
		harnesses.push(belowThresholdHarness);
		const disabledHarness = await createHarness({ settings: { compaction: { enabled: false } } });
		harnesses.push(disabledHarness);

		const belowThresholdSpy = stubRunAutoCompaction(belowThresholdHarness.session);
		const disabledSpy = stubRunAutoCompaction(disabledHarness.session);

		await checkCompaction(
			belowThresholdHarness.session,
			createAssistant(belowThresholdHarness, { stopReason: "stop", totalTokens: 1_000, timestamp: Date.now() }),
		);
		await checkCompaction(
			disabledHarness.session,
			createAssistant(disabledHarness, { stopReason: "stop", totalTokens: 1_000_000, timestamp: Date.now() }),
		);

		expect(belowThresholdSpy).not.toHaveBeenCalled();
		expect(disabledSpy).not.toHaveBeenCalled();
	});
});
