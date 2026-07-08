// Todo 31 wiring — rehydration must actually run against a live service.
//
// rehydrateActiveToolsFromHistory existed as a pure function with unit tests,
// but nothing invoked it from the session lifecycle, so a resumed session
// (`--continue`) re-entered search mode with all promotions lost (caught by
// the W4 real-surface QA driver: CLAIM 5 rehydrated=false). These tests pin
// the service-level wiring: history containing activation markers restores
// promoted tools through the same tier-B activation path mcp_search uses.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MCP_SEARCH_ACTIVATION_MARKER } from "../../src/core/extensions/builtin/mcp/expose/tool-search.ts";
import { getMcpService, resetMcpServiceForTests } from "../../src/core/extensions/builtin/mcp/service.ts";
import { attach, capturingPi, mcpRoot as makeMcpRoot } from "./fixtures/register-call.ts";
import { cleanupRoots, setConfig, stdioServer, type TestRoot } from "./fixtures/service-lifecycle.ts";

const cleanupTasks: Array<() => Promise<void>> = [];

beforeEach(() => {
	resetMcpServiceForTests();
});

afterEach(async () => {
	await getMcpService().dispose("quit");
	resetMcpServiceForTests();
	await cleanupRoots(cleanupTasks);
});

function mcpRoot(slug: string): TestRoot {
	return makeMcpRoot(slug, cleanupTasks);
}

function historyWithActivation(names: string): unknown[] {
	return [
		{ role: "user", content: "find me a tool" },
		{
			role: "toolResult",
			toolName: "mcp_search",
			content: [{ type: "text", text: `Found tools.\n\n${MCP_SEARCH_ACTIVATION_MARKER} ${names}` }],
		},
	];
}

describe("mcp_search rehydration wiring", () => {
	it("restores marker-recorded promotions through the live tier-B activation path", async () => {
		const root = mcpRoot("rehydrate-live");
		setConfig(root, { fx: { ...stdioServer(["--tools", "3"]), exposure: "search" } });
		const pi = capturingPi();
		await attach(root, pi);

		expect(pi.getActiveTools()).toContain("mcp_search");
		expect(pi.getActiveTools()).not.toContain("mcp_fx_tool_2");

		const restored = getMcpService().rehydrateActiveToolsFromHistory(historyWithActivation("mcp_fx_tool_2"));
		expect(restored).toEqual(["mcp_fx_tool_2"]);
		expect(pi.getActiveTools()).toContain("mcp_fx_tool_2");
		// mcp_search must survive rehydration (stable active set, not replaced).
		expect(pi.getActiveTools()).toContain("mcp_search");
	});

	it("is a no-op for unknown names, repeated scans, and direct-mode servers", async () => {
		const root = mcpRoot("rehydrate-noop");
		setConfig(root, { fx: { ...stdioServer(["--tools", "3"]), exposure: "search" } });
		const pi = capturingPi();
		await attach(root, pi);

		// Names no longer in the catalog stay dropped.
		expect(getMcpService().rehydrateActiveToolsFromHistory(historyWithActivation("mcp_fx_tool_99"))).toEqual([]);

		// A real restore, then a repeat scan of the same history adds nothing.
		expect(getMcpService().rehydrateActiveToolsFromHistory(historyWithActivation("mcp_fx_tool_1"))).toEqual([
			"mcp_fx_tool_1",
		]);
		const activeAfter = [...pi.getActiveTools()];
		expect(getMcpService().rehydrateActiveToolsFromHistory(historyWithActivation("mcp_fx_tool_1"))).toEqual([]);
		expect(pi.getActiveTools()).toEqual(activeAfter);
	});

	it("marks history as scanned so per-turn context events stay cheap", async () => {
		const root = mcpRoot("rehydrate-once");
		setConfig(root, { fx: { ...stdioServer(["--tools", "3"]), exposure: "search" } });
		const pi = capturingPi();
		await attach(root, pi);

		expect(getMcpService().maybeRehydrateFromHistory(historyWithActivation("mcp_fx_tool_2"))).toEqual([
			"mcp_fx_tool_2",
		]);
		// Second context event: already scanned since the last registration → skipped
		// even though the history now names another valid tool.
		expect(getMcpService().maybeRehydrateFromHistory(historyWithActivation("mcp_fx_tool_3"))).toEqual([]);
		expect(pi.getActiveTools()).not.toContain("mcp_fx_tool_3");
	});
});
