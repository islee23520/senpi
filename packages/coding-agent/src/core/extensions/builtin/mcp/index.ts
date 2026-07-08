import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "../../types.ts";
import { registerMcpCommands } from "./commands.ts";
import { AnthropicNativeToolSearchAdapter } from "./expose/native-search.ts";
import { MCP_SEARCH_TOOL_NAME } from "./expose/tool-search.ts";
import { injectMcpInstructions, refreshMcpInstructionsForSession } from "./instructions.ts";
import { createMcpLogger } from "./log.ts";
import { getMcpService } from "./service.ts";
import { reportMcpAsyncError, wrapAsync } from "./wrap.ts";

export default function mcpExtension(pi: ExtensionAPI): void {
	let attachPromise: Promise<void> | undefined;
	const sink = {
		logger: {
			error(message: string, data?: unknown): void {
				createMcpLogger("service").error(message, data);
			},
		},
	};

	registerMcpCommands(pi);

	// Native provider tool-search adapter (todo 33 — Anthropic, spike = GO).
	// Runs on every request but is a no-op unless settings.nativeToolSearch is
	// auto|true and the model is anthropic-messages; a 400 disables it for the
	// session and falls back to the always-registered local mcp_search.
	const nativeAdapter = new AnthropicNativeToolSearchAdapter({
		enabled: () => {
			const setting = getMcpService().getNativeToolSearchSetting();
			return setting === true || setting === "auto";
		},
		isDeferrable: (name) => name.startsWith("mcp_") && name !== MCP_SEARCH_TOOL_NAME,
		onFallback: (reason) => createMcpLogger("service").warn(reason),
		searchToolName: MCP_SEARCH_TOOL_NAME,
	});
	pi.on("before_provider_request", (event, ctx) => nativeAdapter.applyBeforeRequest(ctx.model?.api, event.payload));
	pi.on("after_provider_response", (event) => nativeAdapter.noteResponseStatus(event.status));
	// Resumed/compacted sessions carry mcp_search activation markers in their
	// history but re-enter search mode with only directTools active. The context
	// event (fired before each LLM call, with the full message history) replays
	// the markers as a safety net; the primary replay happens at attach time so
	// the FIRST turn's payload already carries previously promoted tools. Scans
	// once per registration (see McpService.maybeRehydrateFromHistory).
	pi.on("context", (event) => {
		getMcpService().maybeRehydrateFromHistory(event.messages);
	});

	// Attach is SINGLE-FLIGHT. session_start handlers are dispatched
	// fire-and-forget, so a slow attach (a cold MCP server's boot + catalog
	// collection is awaited inside attachSession) can still be in flight when
	// before_agent_start fires. The old `attached` boolean was only set on
	// completion, so before_agent_start would start a SECOND concurrent attach —
	// which found the connection entries already created (still "connecting"),
	// collected an empty catalog, and registered no MCP tools for turn 1; the
	// first attach then landed the real registration turns later. Memoizing the
	// in-flight promise makes before_agent_start await the ORIGINAL attach, so
	// the first turn's payload deterministically carries the MCP tool set.
	// session_start always starts a fresh attach (reloads must re-sync config).
	const attach = (event: SessionStartEvent, ctx: ExtensionContext): Promise<void> => {
		attachPromise = (async () => {
			const service = getMcpService();
			await service.attachSession(event, ctx, pi);
			refreshMcpInstructionsForSession(service);
		})();
		return attachPromise;
	};
	pi.on(
		"session_start",
		wrapAsync("mcp.session_start", (event, ctx) => attach(event, ctx), sink),
	);
	pi.on("before_agent_start", async (event, ctx) => {
		try {
			await (attachPromise ?? attach({ type: "session_start", reason: "startup" }, ctx));
			const systemPrompt = injectMcpInstructions(event.systemPrompt);
			return systemPrompt === undefined ? undefined : { systemPrompt };
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			await reportMcpAsyncError("mcp.before_agent_start", error, sink);
			return undefined;
		}
	});
	pi.on(
		"session_shutdown",
		wrapAsync("mcp.session_shutdown", (event) => getMcpService().handleSessionShutdown(event), sink),
	);
}
