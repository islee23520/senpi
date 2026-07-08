/**
 * W4 real-surface QA driver — proves the adaptive-exposure / tool-search
 * headline claims against the ACTUAL CLI request bytes, not an in-process
 * context.tools tap.
 *
 * It boots the real senpi CLI against:
 *   - a real stdio MCP fixture server exposing 30 tools in `exposure:"search"`
 *     (default lazy lifecycle: attachSession awaits the catalog collection, so
 *     turn-1 exposure is deterministic — no 250ms startup race)
 *   - the senpi-qa fake model server (zero real API calls), whose request log
 *     now captures `body.tools` — the wire tool payload per turn
 * and asserts:
 *   CLAIM 1: turn-1 wire tools include mcp_search and ZERO of the 30 inactive
 *            catalog tools (inactive tools cost 0 payload tokens)
 *   CLAIM 2: the MCP-scoped slice of turn-1 wire tools is <1k tokens (chars/4)
 *   CLAIM 3: the promoted tool appears on the wire only AFTER the scripted
 *            mcp_search call (next-turn promotion)
 *   CLAIM 4: the mcp_search wire entry is byte-identical across turns; the
 *            only MCP diff is the appended promoted entry (prompt-cache)
 *   CLAIM 5: a killed+resumed session (`--continue`) rehydrates the promoted
 *            tool into its FIRST wire payload with no re-search
 *
 * Usage: node w4-real-surface.mjs   (exit 0 = all claims pass)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = join(here, "..", "..", "..", ".agents", "skills", "senpi-qa", "scripts", "lib");
const { makeSandbox, runCli, repoRoot, installCleanupHooks, guardRealAuth, createChecks } = await import(
	join(libDir, "common.mjs")
);
const { startFakeModelServer } = await import(join(libDir, "fake-model-server.mjs"));
const { writeMockModelsJson, hermeticEnv } = await import(join(libDir, "mock-loop-support.mjs"));

const API = "openai-completions";
const SEARCH = "mcp_search";
const PROMOTED = "mcp_fx_tool_7";
const MARKER = "W4-REAL-SURFACE-DONE";

installCleanupHooks();
guardRealAuth();
const checks = createChecks("w4-real-surface (MCP search-mode, real CLI wire payload)");
const root = repoRoot();
const fixture = join(root, "packages", "coding-agent", "test", "mcp", "fixtures", "stdio-server.ts");
const box = makeSandbox("w4-real-surface");
const evidence = {};

// 30-tool fixture server in search mode; lazy lifecycle keeps attach blocking
// until the catalog is collected, making turn-1 exposure deterministic.
writeFileSync(
	join(box.agentDir, "mcp.json"),
	JSON.stringify(
		{
			mcpServers: {
				fx: {
					type: "stdio",
					command: process.execPath,
					args: [fixture, "--tools", "30"],
					exposure: "search",
					connectTimeoutMs: 30000,
				},
			},
		},
		null,
		2,
	),
);

const toolRequests = (server) => server.requests.filter((r) => Array.isArray(r.tools) && r.tools.length > 0);
const wireToolNames = (r) => r.tools.map((t) => t?.function?.name ?? t?.name).filter(Boolean);
const mcpEntries = (r) => r.tools.filter((t) => String(t?.function?.name ?? t?.name ?? "").startsWith("mcp_"));
const entryByName = (r, name) => r.tools.find((t) => (t?.function?.name ?? t?.name) === name);
const searchCallCount = (r) =>
	(r.messages ?? []).filter((m) => JSON.stringify(m).includes(`"${SEARCH}"`) && JSON.stringify(m).includes("tool_call"))
		.length;

// ---------------------------------------------------------------------------
// Session 1 — cold session: search → promotion → call promoted tool.
// ---------------------------------------------------------------------------
const server1 = await startFakeModelServer({
	turns: [
		// Query terms mirror the fixture descriptions ("Generated fixture tool 7")
		// so BM25 deterministically ranks tool_7 first.
		{ text: "Searching the MCP catalog.", toolCalls: [{ name: SEARCH, args: { query: "generated fixture tool 7" } }] },
		{ text: "Calling the promoted tool.", toolCalls: [{ name: PROMOTED, args: { value: "w4" } }] },
		{ text: MARKER },
	],
});
writeMockModelsJson(box.agentDir, server1, API);
const args1 = [
	"--provider",
	"mock",
	"--model",
	"mock-model",
	"--no-context-files",
	"--approve",
	"--print",
	`Use mcp_search to find the seventh fixture tool, then call it. End with ${MARKER}.`,
];
const run1 = await runCli(args1, { env: hermeticEnv(box.env), cwd: box.cwd, timeoutMs: 150000 });
const reqs1 = toolRequests(server1);

checks.ok("session1: CLI completed — code=0", run1.code === 0, `code=${run1.code} timedOut=${run1.timedOut}`);
checks.ok("session1: >=2 tool-bearing model requests", reqs1.length >= 2, `toolRequests=${reqs1.length}`);
checks.ok("session1: final marker returned", run1.stdout.includes(MARKER), "");

const turn1 = reqs1[0];
const turn1Names = turn1 ? wireToolNames(turn1) : [];
const catalogLeak = turn1Names.filter((n) => /^mcp_fx_tool_\d+$/.test(n));
checks.ok(
	"CLAIM 1: turn-1 wire payload has mcp_search and ZERO inactive catalog tools",
	turn1Names.includes(SEARCH) && catalogLeak.length === 0,
	`mcp_search=${turn1Names.includes(SEARCH)} catalogLeak=${catalogLeak.length} (${catalogLeak.slice(0, 3)})`,
);

const scoped = turn1 ? mcpEntries(turn1) : [];
const approxTokens = Math.round(JSON.stringify(scoped).length / 4);
checks.ok(
	"CLAIM 2: 30-tool search-mode server resident <1k tokens (chars/4 over MCP-scoped wire tools)",
	scoped.length > 0 && approxTokens < 1000,
	`approxTokens=${approxTokens} scopedEntries=${scoped.length}`,
);

const firstPromotedIdx = reqs1.findIndex((r) => wireToolNames(r).includes(PROMOTED));
checks.ok(
	"CLAIM 3: promoted tool appears on the wire only AFTER the mcp_search turn",
	firstPromotedIdx >= 1,
	`firstSeenAtToolRequest=${firstPromotedIdx}`,
);

if (firstPromotedIdx >= 1 && turn1) {
	const before = JSON.stringify(entryByName(turn1, SEARCH));
	const after = JSON.stringify(entryByName(reqs1[firstPromotedIdx], SEARCH));
	checks.ok(
		"CLAIM 4: mcp_search wire entry byte-identical across turns; promoted entry appended",
		before === after && !!entryByName(reqs1[firstPromotedIdx], PROMOTED),
		`searchStable=${before === after}`,
	);
} else {
	checks.ok(
		"CLAIM 4: mcp_search wire entry byte-identical across turns; promoted entry appended",
		false,
		"no promoted turn",
	);
}

const session1FinalSearchCalls = reqs1.length > 0 ? searchCallCount(reqs1[reqs1.length - 1]) : 0;
evidence.session1 = {
	code: run1.code,
	toolRequestCount: reqs1.length,
	wireToolNamesPerTurn: reqs1.map(wireToolNames),
	approxTokens,
	finalSearchCallsInMessages: session1FinalSearchCalls,
};
await server1.stop();

// ---------------------------------------------------------------------------
// Session 2 — kill + resume (senpi --continue). Rehydration must put the
// promoted tool on the FIRST wire payload with no new mcp_search call.
// ---------------------------------------------------------------------------
const server2 = await startFakeModelServer({
	turns: [
		{ text: "Calling the already-active tool.", toolCalls: [{ name: PROMOTED, args: { value: "resumed" } }] },
		{ text: MARKER },
	],
});
writeMockModelsJson(box.agentDir, server2, API);
const args2 = [
	"--provider",
	"mock",
	"--model",
	"mock-model",
	"--no-context-files",
	"--approve",
	"--continue",
	"--print",
	`Call ${PROMOTED} directly without searching again. End with ${MARKER}.`,
];
const run2 = await runCli(args2, { env: hermeticEnv(box.env), cwd: box.cwd, timeoutMs: 150000 });
const reqs2 = toolRequests(server2);
const resumeTurn1Names = reqs2[0] ? wireToolNames(reqs2[0]) : [];
const rehydrated = resumeTurn1Names.includes(PROMOTED);
// "No re-search" must ignore session1's search living in the replayed history:
// compare against the search-call count the resumed conversation STARTED with.
const noNewSearch = reqs2.every((r) => searchCallCount(r) <= session1FinalSearchCalls);
checks.ok(
	"CLAIM 5: resumed session (--continue) rehydrates promoted tool into turn-1 wire payload with no re-search",
	rehydrated && noNewSearch && run2.stdout.includes(MARKER),
	`rehydrated=${rehydrated} noNewSearch=${noNewSearch} marker=${run2.stdout.includes(MARKER)} resumeToolRequests=${reqs2.length}`,
);
evidence.session2 = {
	code: run2.code,
	toolRequestCount: reqs2.length,
	resumeTurn1WireToolNames: resumeTurn1Names,
	wireToolNamesPerTurn: reqs2.map(wireToolNames),
	markerReturned: run2.stdout.includes(MARKER),
};
await server2.stop();

// Always dump stderr tails: on failure they are the primary forensic surface
// (extension errors, mcp logs); on success they are short.
process.stderr.write(`\n--- session1 stderr tail ---\n${run1.stderr.slice(-2000)}\n`);
process.stderr.write(`\n--- session2 stderr tail ---\n${run2.stderr.slice(-2000)}\n`);

const outDir = join(here, "w4-real-surface-evidence");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "analysis.json"), JSON.stringify(evidence, null, 2));
process.stdout.write(`\n=== W4 wire-payload analysis ===\n${JSON.stringify(evidence, null, 2)}\n`);

const allGreen = checks.finish();
box.cleanup();
process.exit(allGreen ? 0 : 1);
