import { existsSync, readFileSync } from "node:fs";
import type { BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext, LoadedHookSources } from "../../types.ts";
import { loadHookConfigSources } from "./config-loader.ts";
import { dispatchHookEvent } from "./dispatcher.ts";
import {
	appendSystemMessages,
	buildUserPromptHookInput,
	formatPromptContextMessage,
	HOOK_CUSTOM_MESSAGE_TYPE,
	type PendingPromptHookContext,
	promptBlockReasonFromResult,
	promptContextFromResult,
	safeDiagnosticDetails,
} from "./prompt-adapter.ts";
import { emptyHookTrustState } from "./trust.ts";
import { FileHookStateStorage } from "./trust-storage.ts";
import type {
	HookDiagnostic,
	HookRuntimeState,
	HookTrustState,
	ParsedHookConfig,
	SupportedHookEvent,
} from "./types.ts";

export { parseHookConfig } from "./schema.ts";
export type {
	CommandHookConfig,
	ExecutableHookHandler,
	HookDiagnostic,
	HookDiagnosticCode,
	HookInputWire,
	HookOutputWire,
	HookRuntimeState,
	HookSourceMetadata,
	HookTrustEntry,
	HookTrustState,
	ParsedHookConfig,
	SupportedHookEvent,
	UnsupportedKnownHookEvent,
} from "./types.ts";

export default function hooksExtension(pi: ExtensionAPI): void {
	const pendingPromptContexts: PendingPromptHookContext[] = [];

	const refreshState = (ctx: ExtensionContext): HookRuntimeState => {
		const sources = ctx.getLoadedHookSources?.() ?? fallbackHookSources(ctx.cwd);
		const parsed = loadHookConfigSources({
			agentDir: sources.agentDir,
			cwd: sources.cwd,
			fileSystem: {
				readTextFile(path) {
					return existsSync(path) ? readFileSync(path, "utf-8") : undefined;
				},
			},
			globalHookSourcePaths: sources.globalHookSourcePaths,
			globalHooksPath: sources.globalHooksPath,
			globalSettingsHooks: sources.globalSettingsHooks,
			preSessionHookSourcePaths: sources.preSessionHookSourcePaths,
			projectHookSourcePaths: sources.projectHookSourcePaths,
			projectHooksPath: sources.projectHooksPath,
			projectSettingsHooks: sources.projectSettingsHooks,
			runtimeHookSourcePaths: sources.runtimeHookSourcePaths,
		});
		const storage = new FileHookStateStorage({ agentDir: sources.agentDir, cwd: sources.cwd });
		const trust = mergeTrustStates(
			storage.read("global"),
			ctx.isProjectTrusted() ? storage.read("project") : emptyHookTrustState(),
		);
		return { parsed, trust };
	};

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") return undefined;
		pendingPromptContexts.splice(0);
		const state = refreshState(ctx);
		const input = buildUserPromptHookInput({
			cwd: ctx.cwd,
			permissionMode: "default",
			prompt: event.text,
			sessionId: ctx.sessionManager.getSessionId(),
			transcriptPath: ctx.sessionManager.getSessionFile(),
		});
		const result = await dispatchHookEvent({
			cwd: ctx.cwd,
			handlers: state.parsed.executableHandlers,
			input,
			signal: ctx.signal,
			trustOptions: { platform: process.platform },
			trustState: state.trust,
		});
		if (result.decision.kind === "block") {
			const reason = promptBlockReasonFromResult(result);
			ctx.ui.notify(reason, "warning");
			pi.sendMessage(
				{
					customType: HOOK_CUSTOM_MESSAGE_TYPE,
					content: reason,
					display: false,
					details: {
						decision: "block",
						event: "UserPromptSubmit",
						sourcePath: result.decision.source.sourcePath,
					},
				},
				{ triggerTurn: false },
			);
			return { action: "handled" };
		}
		if (ctx.isIdle()) {
			const pending = promptContextFromResult(result);
			if (pending !== undefined) {
				pendingPromptContexts.push(pending);
			}
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event) => {
		const pending = pendingPromptContexts.shift();
		if (pending === undefined) return undefined;

		const messageContent = formatPromptContextMessage(pending);
		const systemPrompt = appendSystemMessages(event.systemPrompt, pending.systemMessages);
		if (messageContent === undefined && systemPrompt === event.systemPrompt) return undefined;

		const result: BeforeAgentStartEventResult = {};
		if (messageContent !== undefined) {
			result.message = {
				customType: HOOK_CUSTOM_MESSAGE_TYPE,
				content: messageContent,
				display: false,
				details: {
					event: "UserPromptSubmit",
					diagnostics: pending.diagnostics.map(safeDiagnosticDetails),
				},
			};
		}
		if (systemPrompt !== event.systemPrompt) {
			result.systemPrompt = systemPrompt;
		}
		return result;
	});

	pi.registerCommand("hooks", {
		description: "Inspect loaded builtin hook sources and diagnostics.",
		handler: async (_args, ctx) => {
			const state = refreshState(ctx);
			ctx.ui.notify(formatHookStatus(state.parsed));
		},
	});
}

function mergeTrustStates(globalState: HookTrustState, projectState: HookTrustState): HookTrustState {
	return { version: 1, hooks: { ...globalState.hooks, ...projectState.hooks } };
}

function fallbackHookSources(cwd: string): LoadedHookSources {
	return {
		agentDir: cwd,
		cwd,
		globalHookSourcePaths: [],
		globalHooksPath: `${cwd}/hooks.json`,
		preSessionHookSourcePaths: [],
		projectHookSourcePaths: [],
		projectHooksPath: `${cwd}/.senpi/hooks.json`,
		runtimeHookSourcePaths: [],
	};
}

function formatHookStatus(parsed: ParsedHookConfig): string {
	const counts = new Map<SupportedHookEvent, number>();
	for (const handler of parsed.executableHandlers) {
		counts.set(handler.event, (counts.get(handler.event) ?? 0) + 1);
	}
	const summary =
		counts.size === 0
			? "hooks: no executable hooks"
			: `hooks: ${parsed.executableHandlers.length} executable hooks (${Array.from(counts.entries())
					.map(([event, count]) => `${event}:${count}`)
					.join(", ")})`;
	return appendHookDiagnostics(summary, parsed.diagnostics);
}

function appendHookDiagnostics(summary: string, diagnostics: readonly HookDiagnostic[]): string {
	if (diagnostics.length === 0) {
		return summary;
	}
	const lines = diagnostics.map(
		(diagnostic) =>
			`${diagnostic.severity}: ${diagnostic.code} ${diagnostic.source.sourcePath} ${diagnostic.path} ${diagnostic.message}`,
	);
	return [summary, ...lines].join("\n");
}

export {
	SUPPORTED_HOOK_EVENTS,
	UNSUPPORTED_HANDLER_TYPES,
	UNSUPPORTED_KNOWN_HOOK_EVENTS,
} from "./types.ts";
