import type { ExtensionAPI } from "../../types.ts";
import { registerMcpCommands } from "./commands.ts";
import { AnthropicNativeToolSearchAdapter } from "./expose/native-search.ts";
import { MCP_SEARCH_TOOL_NAME } from "./expose/tool-search.ts";
import { injectMcpInstructions, refreshMcpInstructionsForSession } from "./instructions.ts";
import { createMcpLogger } from "./log.ts";
import { getMcpService } from "./service.ts";
import { reportMcpAsyncError, wrapAsync } from "./wrap.ts";

export default function mcpExtension(pi: ExtensionAPI): void {
	let attached = false;
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

	pi.on(
		"session_start",
		wrapAsync(
			"mcp.session_start",
			async (event, ctx) => {
				const service = getMcpService();
				await service.attachSession(event, ctx, pi);
				refreshMcpInstructionsForSession(service);
				attached = true;
			},
			sink,
		),
	);
	pi.on("before_agent_start", async (event, ctx) => {
		try {
			if (!attached) {
				const service = getMcpService();
				await service.attachSession({ type: "session_start", reason: "startup" }, ctx, pi);
				refreshMcpInstructionsForSession(service);
				attached = true;
			}
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
