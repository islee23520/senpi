/**
 * Channel 3 — Mock-loop QA (deterministic, zero real API calls, zero tokens).
 *
 * Spins up a local fake model server, registers it via a baseUrl override in an
 * isolated models.json, and drives a REAL agent turn through the actual CLI.
 * Supports the three wire formats senpi uses, so baseUrl override is QA-covered
 * for OpenAI (chat completions + responses) AND Anthropic:
 *   --api openai-completions   provider "mock"      -> /v1/chat/completions (Bearer)
 *   --api anthropic-messages   provider "anthropic" -> /v1/messages       (x-api-key)
 *   --api openai-responses     provider "openai"    -> /v1/responses       (Bearer)
 *
 * A pass proves the live binary talked to OUR localhost server with the mock
 * key — never a real provider.
 *
 * Usage:
 *   node mock-loop.mjs --self-test                       # all three APIs round-trip
 *   node mock-loop.mjs --self-test --api anthropic-messages
 *   node mock-loop.mjs --with-tool [--api ...]           # full loop: model -> bash -> final text
 *   node mock-loop.mjs --with-mcp-tool mcp_fx_tool_1 --tool-args '{"value":"ok"}'
 *   node mock-loop.mjs --run "prompt" [--api ...] [--evidence SLUG]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	createChecks,
	evidenceDir,
	guardRealAuth,
	installCleanupHooks,
	makeSandbox,
	repoRoot,
	runCli,
	tsxEntry,
} from "./lib/common.mjs";
import { startFakeModelServer } from "./lib/fake-model-server.mjs";

/** Per-API: which provider to override, model id, key, auth header, and how to derive baseUrl. */
const API_PRESETS = {
	"openai-completions": { provider: "mock", modelId: "mock-model", apiKey: "sk-mock-qa-7f3a", auth: "bearer", path: "/chat/completions", baseUrl: (s) => s.url },
	"anthropic-messages": { provider: "anthropic", modelId: "mock-claude", apiKey: "sk-ant-mock-7f3a", auth: "x-api-key", path: "/messages", baseUrl: (s) => s.origin },
	"openai-responses": { provider: "openai", modelId: "mock-gpt", apiKey: "sk-openai-mock-7f3a", auth: "bearer", path: "/responses", baseUrl: (s) => s.url },
};
const ALL_APIS = Object.keys(API_PRESETS);

// Real provider keys in the ambient env would otherwise take precedence over the
// inline models.json key for built-in providers (anthropic/openai), so a real
// key could reach even the localhost fake. Strip them: the mock loop must be
// hermetic and use ONLY the inline mock key.
const PROVIDER_ENV_KEYS = [
	"ANTHROPIC_API_KEY", "ANTHROPIC_OAUTH_TOKEN", "OPENAI_API_KEY", "AZURE_OPENAI_API_KEY", "DEEPSEEK_API_KEY",
	"NVIDIA_API_KEY", "GEMINI_API_KEY", "GOOGLE_CLOUD_API_KEY", "GROQ_API_KEY", "CEREBRAS_API_KEY", "XAI_API_KEY",
	"FIREWORKS_API_KEY", "TOGETHER_API_KEY", "OPENROUTER_API_KEY", "AI_GATEWAY_API_KEY", "ZAI_API_KEY",
	"ZAI_CODING_CN_API_KEY", "MISTRAL_API_KEY", "MINIMAX_API_KEY", "MINIMAX_CN_API_KEY", "MOONSHOT_API_KEY",
	"MOONSHOTAI_API_KEY", "KIMI_API_KEY", "OPENCODE_API_KEY", "CLOUDFLARE_API_KEY", "HF_TOKEN",
];

function hermeticEnv(boxEnv) {
	const env = { ...boxEnv };
	for (const k of PROVIDER_ENV_KEYS) delete env[k];
	return env;
}

function writeMockModelsJson(agentDir, server, apiName) {
	const p = API_PRESETS[apiName];
	const baseUrl = p.baseUrl(server);
	const config = {
		providers: {
			[p.provider]: {
				baseUrl,
				apiKey: p.apiKey,
				api: apiName,
				models: [
					{ id: p.modelId, baseUrl, api: apiName, contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
				],
			},
		},
	};
	writeFileSync(join(agentDir, "models.json"), JSON.stringify(config, null, 2));
}

async function driveTurn({ apiName, turns, prompt, extraArgs = [], prepareSandbox, timeoutMs = 90000 }) {
	const p = API_PRESETS[apiName];
	const box = makeSandbox(`mock-loop-${apiName}`);
	const server = await startFakeModelServer({ turns });
	writeMockModelsJson(box.agentDir, server, apiName);
	const prepared = prepareSandbox ? await prepareSandbox(box) : {};
	const args = [
		"--provider",
		p.provider,
		"--model",
		p.modelId,
		"--no-context-files",
		"--no-extensions",
		...(prepared.extraArgs ?? []),
		...extraArgs,
		"--print",
		prompt,
	];
	const result = await runCli(args, { env: hermeticEnv(box.env), cwd: box.cwd, timeoutMs });
	return { box, server, result, preset: p, prepared };
}

/** Assert one API round-trips through the real loop via baseUrl override. */
async function checkApi(checks, apiName) {
	const marker = `SENPI-QA-MOCK-${apiName}-4d9c`;
	const { box, server, result, preset } = await driveTurn({ apiName, turns: [{ text: marker }], prompt: "Reply with the secret marker exactly." });
	const got = (result.stdout + result.stderr).includes(marker);
	const req = server.requests.find((r) => r.url && r.url.includes(preset.path));
	const authOk = preset.auth === "x-api-key" ? req?.apiKeyHeader === preset.apiKey : req?.authorization === `Bearer ${preset.apiKey}`;
	const pass = result.code === 0 && got && !!req && req.model === preset.modelId && authOk;
	checks.ok(`${apiName}: baseUrl override round-trips through the real loop`, pass, `code=${result.code} marker=${got} path=${req?.url ?? "none"} auth=${authOk}`);
	if (!pass) process.stderr.write(`\n--- ${apiName} stderr tail ---\n${result.stderr.slice(-1200)}\n`);
	await server.stop();
	box.cleanup();
	return pass;
}

async function selfTest(onlyApi) {
	installCleanupHooks();
	const checks = createChecks("mock-loop.mjs --self-test");
	const guard = guardRealAuth();
	const apis = onlyApi ? [onlyApi] : ALL_APIS;
	for (const api of apis) await checkApi(checks, api);
	checks.ok("zero real provider calls (only localhost fake hit)", true, "all baseUrls point at 127.0.0.1");
	checks.ok("real auth unchanged", (() => {
		try {
			return guard.assertUnchanged();
		} catch {
			return false;
		}
	})(), guard.path);
	process.exit(checks.finish() ? 0 : 1);
}

async function withTool(apiName) {
	return withNamedTool({
		apiName,
		checkName: `mock-loop.mjs --with-tool (${apiName})`,
		toolName: "bash",
		toolArgs: { command: "echo TOOL-LOOP-OK-22b8" },
		marker: "TOOL-LOOP-OK-22b8",
		extraArgs: ["--approve"],
	});
}

async function withMcpTool(apiName, toolName, toolArgs, evidenceSlug) {
	assertMcpFixtureToolName(toolName);
	const fixture = mcpFixtureForToolName(toolName);
	return withNamedTool({
		apiName,
		checkName: `mock-loop.mjs --with-mcp-tool ${toolName} (${apiName})`,
		toolName,
		toolArgs,
		marker: `MCP-TOOL-LOOP-OK:${toolName}:${fixture.resultPrefix}`,
		extraArgs: ["--approve", "--tools", toolName],
		prepareSandbox: (box) => writeMcpFixtureExtension(box, { toolName, fixture }),
		validateToolResult: ({ prepared, server }) => validateMcpFixtureToolResult({ prepared, server }),
		evidenceSlug,
	});
}

async function withNamedTool({
	apiName,
	checkName,
	toolName,
	toolArgs,
	marker,
	extraArgs,
	prepareSandbox,
	validateToolResult,
	evidenceSlug,
}) {
	installCleanupHooks();
	const checks = createChecks(checkName);
	const guard = guardRealAuth();
	const { box, server, result, prepared } = await driveTurn({
		apiName,
		turns: [{ toolCalls: [{ name: toolName, args: toolArgs }] }, { text: `Done: ${marker}` }],
		prompt: `Call the ${toolName} tool and report the output.`,
		extraArgs,
		prepareSandbox,
		timeoutMs: 120000,
	});
	checks.ok("CLI completed the multi-step loop", !result.timedOut, `code=${result.code}`);
	checks.ok("two model turns served (loop iterated)", server.requests.length >= 2, `requests=${server.requests.length}`);
	if (validateToolResult) {
		const toolResult = validateToolResult({ prepared, server, result });
		checks.ok(toolResult.name, toolResult.pass, toolResult.detail);
	}
	checks.ok("final assistant text returned", (result.stdout + result.stderr).includes(marker));
	checks.ok("real auth unchanged", (() => {
		try {
			return guard.assertUnchanged();
		} catch {
			return false;
		}
	})());
	if (evidenceSlug) writeToolEvidence(evidenceSlug, { apiName, result, server, prepared });
	if (result.timedOut || server.requests.length < 2) process.stderr.write(`\n--- stderr tail ---\n${result.stderr.slice(-1500)}\n`);
	await server.stop();
	box.cleanup();
	process.exit(checks.finish() ? 0 : 1);
}

function assertMcpFixtureToolName(toolName) {
	if (!/^mcp_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/.test(toolName)) {
		throw new Error(`--with-mcp-tool requires an mcp_<server>_<tool> name, got: ${toolName}`);
	}
	if (!/^mcp_fx_tool_\d+$/.test(toolName)) {
		throw new Error(`mock-loop MCP fixture can register mcp_fx_tool_<n> tools only, got: ${toolName}`);
	}
}

function mcpFixtureForToolName(toolName) {
	const match = /^mcp_fx_tool_(\d+)$/.exec(toolName);
	const toolIndex = Number(match?.[1] ?? "1");
	return {
		sourceToolName: `tool_${toolIndex}`,
		toolCount: toolIndex,
		resultPrefix: `fixture tool_${toolIndex}`,
	};
}

function writeMcpFixtureExtension(box, { toolName, fixture }) {
	const root = repoRoot();
	const callLogPath = join(box.dir, "mcp-fixture-calls.jsonl");
	const extensionPath = join(box.dir, "mcp-fixture-extension.mjs");
	const typeboxUrl = pathToFileURL(join(root, "node_modules", "typebox", "build", "index.mjs")).href;
	const clientUrl = pathToFileURL(
		join(root, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "index.js"),
	).href;
	const stdioUrl = pathToFileURL(
		join(root, "node_modules", "@modelcontextprotocol", "sdk", "dist", "esm", "client", "stdio.js"),
	).href;
	const source = `
import { appendFileSync } from "node:fs";
import { Type } from ${JSON.stringify(typeboxUrl)};
import { Client } from ${JSON.stringify(clientUrl)};
import { StdioClientTransport } from ${JSON.stringify(stdioUrl)};

const toolName = ${JSON.stringify(toolName)};
const sourceToolName = ${JSON.stringify(fixture.sourceToolName)};
const callLogPath = ${JSON.stringify(callLogPath)};
const fixtureCommand = ${JSON.stringify(process.execPath)};
const fixtureArgs = ${JSON.stringify([
		tsxEntry(root),
		"--tsconfig",
		join(root, "tsconfig.json"),
		join(root, "packages", "coding-agent", "test", "mcp", "fixtures", "stdio-server.ts"),
		"--tools",
		String(fixture.toolCount),
	])};

export default function(pi) {
	pi.registerTool({
		name: toolName,
		label: "MCP fixture tool",
		description: "senpi-qa local MCP stdio fixture proxy. Returns deterministic fixture text.",
		parameters: Type.Object({
			value: Type.Optional(Type.String()),
			mode: Type.Optional(Type.String()),
			nested: Type.Optional(Type.Any())
		}, { additionalProperties: true }),
		async execute(toolCallId, params) {
			const transport = new StdioClientTransport({ command: fixtureCommand, args: fixtureArgs, stderr: "pipe" });
			const client = new Client({ name: "senpi-qa-mcp-fixture-proxy", version: "0.0.0" });
			try {
				await client.connect(transport, { timeout: 3000 });
				const listed = await client.listTools();
				if (!listed.tools.some((tool) => tool.name === sourceToolName)) {
					throw new Error("MCP fixture did not list " + sourceToolName);
				}
				const result = await client.callTool({ name: sourceToolName, arguments: params });
				appendFileSync(callLogPath, JSON.stringify({ toolCallId, toolName, sourceToolName, params, listed: listed.tools.map((tool) => tool.name), result }) + "\\n");
				return { content: result.content, details: { fixture: "mcp-stdio", sourceToolName, listed: listed.tools.map((tool) => tool.name) } };
			} finally {
				await client.close().catch(() => undefined);
			}
		}
	});
}
`;
	writeFileSync(extensionPath, source);
	return {
		extraArgs: ["--extension", extensionPath],
		callLogPath,
		expectedResultText: fixture.resultPrefix,
		extensionPath,
	};
}

function validateMcpFixtureToolResult({ prepared, server }) {
	const calls = readFixtureCalls(prepared.callLogPath);
	const fixtureCall = calls.find((call) => call.toolName && call.sourceToolName);
	const requestSawResult = server.requests
		.slice(1)
		.some((request) => JSON.stringify(request.messages ?? "").includes(prepared.expectedResultText));
	return {
		name: "requested MCP fixture tool exists, executed, and fed result back to model",
		pass: !!fixtureCall && requestSawResult,
		detail: `callLog=${fixtureCall ? "yes" : "no"} modelSawFixtureResult=${requestSawResult}`,
	};
}

function readFixtureCalls(path) {
	if (!path || !existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				return {};
			}
		});
}

function writeToolEvidence(slug, { apiName, result, server, prepared }) {
	const dir = evidenceDir(slug);
	writeFileSync(join(dir, `mock-loop-${apiName}-stdout.txt`), result.stdout);
	writeFileSync(join(dir, `mock-loop-${apiName}-stderr.txt`), result.stderr);
	writeFileSync(join(dir, `mock-loop-${apiName}-requests.json`), JSON.stringify(sanitizeRequests(server.requests), null, 2));
	if (prepared.callLogPath && existsSync(prepared.callLogPath)) {
		writeFileSync(join(dir, "mcp-fixture-calls.jsonl"), readFileSync(prepared.callLogPath, "utf8"));
	}
	writeFileSync(
		join(dir, "summary.json"),
		JSON.stringify(
			{
				command: `node .agents/skills/senpi-qa/scripts/mock-loop.mjs ${process.argv.slice(2).join(" ")}`,
				apiName,
				requests: server.requests.length,
				fixtureCallLog: prepared.callLogPath ? "mcp-fixture-calls.jsonl" : null,
			},
			null,
			2,
		),
	);
	process.stderr.write(`evidence: ${dir}\n`);
}

function sanitizeRequests(requests) {
	return requests.map((request) => ({
		...request,
		authorization: request.authorization ? "<mock-redacted>" : null,
		apiKeyHeader: request.apiKeyHeader ? "<mock-redacted>" : null,
	}));
}

async function run(prompt, apiName, slug) {
	installCleanupHooks();
	const guard = guardRealAuth();
	const marker = "SENPI-QA-MOCK";
	const { box, server, result } = await driveTurn({ apiName, turns: [{ text: `${marker}: ${prompt}` }], prompt });
	process.stdout.write(`${result.stdout}\n`);
	if (slug) {
		const dir = evidenceDir(slug);
		writeFileSync(join(dir, `mock-loop-${apiName}-stdout.txt`), result.stdout);
		writeFileSync(join(dir, `mock-loop-${apiName}-requests.json`), JSON.stringify(server.requests, null, 2));
		process.stderr.write(`evidence: ${dir}\n`);
	}
	guard.assertUnchanged();
	await server.stop();
	box.cleanup();
}

const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};
const api = flag("--api");
if (api && !API_PRESETS[api]) {
	process.stderr.write(`unknown --api ${api}. valid: ${ALL_APIS.join(", ")}\n`);
	process.exit(2);
}

function parseToolArgs() {
	const raw = flag("--tool-args");
	if (!raw) return {};
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
	} catch {}
	throw new Error("--tool-args must be a JSON object");
}

if (argv[0] === "--self-test") {
	selfTest(api).catch((e) => {
		process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
		process.exit(1);
	});
} else if (argv[0] === "--with-tool") {
	withTool(api || "openai-completions").catch((e) => {
		process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
		process.exit(1);
	});
} else if (argv[0] === "--with-mcp-tool") {
	Promise.resolve()
		.then(() => {
			const toolName = flag("--tool-name") || positionalAfter("--with-mcp-tool") || "mcp_fx_tool_1";
			return withMcpTool(api || "openai-completions", toolName, parseToolArgs(), flag("--evidence"));
		})
		.catch((e) => {
			process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
			process.exit(1);
		});
} else if (argv[0] === "--run") {
	run(argv[1] || "say hello", api || "openai-completions", flag("--evidence")).catch((e) => {
		process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
		process.exit(1);
	});
} else {
	process.stdout.write(
		[
			"senpi-qa Channel 3 — Mock loop (zero real API calls)",
			"  node mock-loop.mjs --self-test [--api <name>]   round-trip 1 or all 3 wire formats",
			"  node mock-loop.mjs --with-tool [--api <name>]   full loop with a bash tool call",
			"  node mock-loop.mjs --with-mcp-tool <tool> [--tool-args JSON]",
			"  node mock-loop.mjs --run <prompt> [--api <name>]",
			`  APIs: ${ALL_APIS.join(", ")}`,
			"",
		].join("\n"),
	);
}

function positionalAfter(command) {
	const start = argv.indexOf(command);
	if (start < 0) return undefined;
	const valuedFlags = new Set(["--api", "--tool-name", "--tool-args", "--evidence"]);
	for (let index = start + 1; index < argv.length; index++) {
		const arg = argv[index];
		if (valuedFlags.has(arg)) {
			index++;
			continue;
		}
		if (!arg.startsWith("--")) return arg;
	}
	return undefined;
}
