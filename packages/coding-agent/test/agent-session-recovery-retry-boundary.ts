import { join } from "node:path";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
	type AssistantMessage,
	createAssistantMessageEventStream,
	getModel,
	wrapStreamWithInvokeRecovery,
} from "@earendil-works/pi-ai/compat";
import { Type } from "typebox";
import { expect, it } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createModelRegistry, getModelRuntime } from "./model-runtime-test-utils.ts";
import { createTestResourceLoader } from "./utilities.ts";

const echoTool: AgentTool = {
	name: "Echo",
	label: "Echo",
	description: "Echo text",
	parameters: Type.Object({ value: Type.String() }),
	execute: async () => ({ content: [{ type: "text", text: "echoed" }], details: undefined }),
};

function message(text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: 1,
	};
}

function textStream(text: string, terminal: "done" | "error") {
	const stream = createAssistantMessageEventStream();
	queueMicrotask(() => {
		const partial = message(text, terminal === "done" ? "stop" : "error");
		stream.push({ type: "start", partial: { ...partial, content: [] } });
		stream.push({ type: "text_start", contentIndex: 0, partial });
		stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial });
		if (terminal === "error") {
			stream.push({
				type: "error",
				reason: "error",
				error: { ...partial, errorMessage: "overloaded_error" },
			});
			return;
		}
		stream.push({ type: "text_end", contentIndex: 0, content: text, partial });
		stream.push({ type: "done", reason: "stop", message: partial });
	});
	return stream;
}

export function registerAgentSessionRecoveryRetryBoundaryCase(
	tempDir: () => string,
	setSession: (session: AgentSession) => void,
): void {
	it("creates a fresh recovery wrapper when AgentSession auto-retry re-invokes streamFn", async () => {
		const selected = getModel("anthropic", "claude-sonnet-4-5");
		if (!selected) throw new Error("Claude retry fixture model is unavailable");
		let calls = 0;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model: selected, systemPrompt: "Test", tools: [echoTool] },
			streamFn: () => {
				calls++;
				if (calls === 1) {
					return wrapStreamWithInvokeRecovery(textStream("<invoke na", "error"), [echoTool]);
				}
				if (calls === 2) {
					return wrapStreamWithInvokeRecovery(
						textStream('<invoke name="Echo"><parameter name="value">second-attempt</parameter></invoke>', "done"),
						[echoTool],
					);
				}
				return textStream("Final answer", "done");
			},
		});
		const directory = tempDir();
		const settings = SettingsManager.create(directory, directory);
		settings.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
		const auth = AuthStorage.create(join(directory, "auth.json"));
		await auth.modify("anthropic", async () => ({ type: "api_key", key: "test-key" }));
		const registry = await createModelRegistry(auth, directory);
		const created = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settingsManager: settings,
			cwd: directory,
			modelRuntime: getModelRuntime(registry),
			resourceLoader: createTestResourceLoader(),
			baseToolsOverride: { Echo: echoTool },
		});
		setSession(created);
		let retryStarted!: () => void;
		const retrySignal = new Promise<void>((resolve) => (retryStarted = resolve));
		const recovered: AssistantMessage[] = [];
		created.subscribe((event) => {
			if (event.type === "auto_retry_start") retryStarted();
			if (event.type === "message_end" && event.message.role === "assistant") recovered.push(event.message);
		});
		const prompt = created.prompt("Test");
		await retrySignal;
		await prompt;
		const retriedCall = recovered
			.flatMap((entry) => entry.content)
			.find((content) => content.type === "toolCall" && content.arguments.value === "second-attempt");
		expect(calls).toBe(3);
		expect(retriedCall).toMatchObject({ id: "recovered-antml-0", arguments: { value: "second-attempt" } });
		expect(JSON.stringify(recovered)).not.toContain("<invoke nasecond-attempt");
	});
}
