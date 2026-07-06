import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
	loadMcpConfig,
	McpConfigValidationError,
	visitSpawnableMcpServers,
} from "../../src/core/extensions/builtin/mcp/config.ts";

const TOKEN_EXPR = "$" + "{TOKEN}";
const TOKEN_DEFAULT_EXPR = "$" + "{TOKEN:-global}";
const CLAUDE_ARG_DEFAULT_EXPR = "$" + "{CLAUDE_ARG:-from-default}";
const PROJECT_COMMAND_EXPR = "$" + "{PROJECT_COMMAND}";

describe("mcp config", () => {
	it("discovers, merges, imports, interpolates, and normalizes trusted config", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			settings: { importConfigs: ["claude"], nativeToolSearch: "auto", toolPrefix: "global" },
			mcpServers: {
				shared: { command: "global-shared", args: [TOKEN_DEFAULT_EXPR] },
				globalOnly: { url: "https://global.example/mcp", headers: { Authorization: `Bearer ${TOKEN_EXPR}` } },
			},
		});
		writeJson(join(root.cwd, ".mcp.json"), {
			mcpServers: {
				claudeOnly: { command: "claude", args: [CLAUDE_ARG_DEFAULT_EXPR] },
			},
		});
		writeJson(join(root.cwd, ".senpi", "mcp.json"), {
			settings: {
				oauthCallbackUrl: "https://callback.example/finish",
				stubSwap: true,
				toolPrefix: "project",
			},
			mcpServers: {
				shared: {
					command: "project-shared",
					args: [TOKEN_EXPR],
					bearerTokenEnv: "PROJECT_TOKEN",
					oauth: { flow: "client_credentials", scopes: ["tools"] },
					logLevel: "warning",
				},
			},
		});

		const result = loadMcpConfig({
			agentDir: root.agentDir,
			cwd: root.cwd,
			env: { TOKEN: "from-env" },
			projectTrusted: true,
		});

		expect(result.settings).toMatchObject({
			importConfigs: ["claude"],
			nativeToolSearch: "auto",
			oauthCallbackUrl: "https://callback.example/finish",
			stubSwap: true,
			toolPrefix: "project",
		});
		expect(result.servers.shared).toMatchObject({
			source: "project",
			state: "enabled",
			transport: "stdio",
			config: {
				args: ["from-env"],
				bearerTokenEnv: "PROJECT_TOKEN",
				command: "project-shared",
				logLevel: "warning",
				oauth: { flow: "client_credentials", scopes: ["tools"] },
			},
		});
		expect(result.servers.globalOnly).toMatchObject({
			source: "global",
			transport: "http",
			config: { headers: { Authorization: "Bearer from-env" } },
		});
		expect(result.servers.claudeOnly).toMatchObject({
			source: "claude",
			state: "enabled",
			config: { args: ["from-default"] },
		});
		expect(result.diagnostics).toEqual([]);
	});

	it("does not import .mcp.json unless claude import is enabled", () => {
		const root = makeRoot();
		writeJson(join(root.cwd, ".mcp.json"), {
			mcpServers: { claudeOnly: { command: "claude" } },
		});

		const result = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(result.servers.claudeOnly).toBeUndefined();
	});

	it("reports validation failures with exact JSON paths", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: { x: { command: "npx", args: "not-an-array" } },
		});

		expect(() => loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true })).toThrow(
			new McpConfigValidationError("Invalid MCP config at mcpServers.x.args: Expected array"),
		);
	});

	it("rejects command substitution syntax without executing config", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				shellBang: { command: "!curl https://example.invalid/install.sh" },
			},
		});

		expect(() => loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true })).toThrow(
			/MCP config interpolation rejected command substitution at mcpServers\.shellBang\.command.*security/i,
		);

		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				subshell: { command: "node", args: ["$(touch should-not-exist)"] },
			},
		});

		expect(() => loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true })).toThrow(
			/MCP config interpolation rejected command substitution at mcpServers\.subshell\.args\.0.*security/i,
		);
	});

	it("keeps configHash stable under object key reordering", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				stable: { env: { B: "2", A: "1" }, args: ["a"], command: "node" },
			},
		});
		const first = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				stable: { command: "node", args: ["a"], env: { A: "1", B: "2" } },
			},
		});
		const second = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(second.servers.stable.configHash).toBe(first.servers.stable.configHash);
	});

	it("validates and round-trips reserved inert future fields", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			settings: {
				oauthCallbackUrl: "https://callback.example/mcp",
				stubSwap: false,
				nativeToolSearch: true,
			},
			mcpServers: {
				future: {
					command: "node",
					auth: "oauth",
					bearerTokenEnv: "TOKEN_ENV",
					logLevel: "debug",
					oauth: {
						clientId: "client-id",
						clientMetadataUrl: "https://client.example/metadata.json",
						flow: "code",
						scopes: ["read", "write"],
					},
				},
			},
		});

		const result = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(result.settings).toMatchObject({
			nativeToolSearch: true,
			oauthCallbackUrl: "https://callback.example/mcp",
			stubSwap: false,
		});
		expect(result.servers.future.config).toMatchObject({
			auth: "oauth",
			bearerTokenEnv: "TOKEN_ENV",
			logLevel: "debug",
			oauth: {
				clientId: "client-id",
				clientMetadataUrl: "https://client.example/metadata.json",
				flow: "code",
				scopes: ["read", "write"],
			},
		});
	});

	it("validates and round-trips keep-alive server lifecycle", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				keepAlive: {
					command: "node",
					lifecycle: "keep-alive",
				},
			},
		});

		const result = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(result.servers.keepAlive.config).toMatchObject({
			command: "node",
			lifecycle: "keep-alive",
		});
	});

	it("validates and round-trips boolean directTools", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: {
				direct: {
					command: "node",
					directTools: true,
				},
			},
		});

		const result = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(result.servers.direct.config).toMatchObject({
			command: "node",
			directTools: true,
		});
	});

	it("validates and round-trips output guard maxLines", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			settings: {
				outputGuard: {
					maxBytes: 1000,
					maxLines: 42,
					maxTokens: 200,
				},
			},
		});

		const result = loadMcpConfig({ agentDir: root.agentDir, cwd: root.cwd, projectTrusted: true });

		expect(result.settings.outputGuard).toEqual({
			maxBytes: 1000,
			maxLines: 42,
			maxTokens: 200,
		});
	});

	it("blocks untrusted project servers before interpolation and spawn", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: { globalOnly: { command: "global" } },
		});
		writeJson(join(root.cwd, ".senpi", "mcp.json"), {
			mcpServers: { projectOnly: { command: PROJECT_COMMAND_EXPR } },
		});
		const spawn = vi.fn();

		const result = loadMcpConfig({
			agentDir: root.agentDir,
			cwd: root.cwd,
			env: { PROJECT_COMMAND: "must-not-interpolate" },
			projectTrusted: false,
		});
		visitSpawnableMcpServers(result, spawn);

		expect(result.servers.globalOnly).toMatchObject({ source: "global", state: "enabled" });
		expect(result.servers.projectOnly).toMatchObject({ source: "project", state: "untrusted" });
		expect(result.servers.projectOnly.config).toBeUndefined();
		expect(spawn).toHaveBeenCalledTimes(1);
		expect(spawn).toHaveBeenCalledWith("globalOnly", result.servers.globalOnly);
	});

	it("loads project servers when project trust is active", () => {
		const root = makeRoot();
		writeJson(join(root.agentDir, "mcp.json"), {
			mcpServers: { globalOnly: { command: "global" } },
		});
		writeJson(join(root.cwd, ".senpi", "mcp.json"), {
			mcpServers: { projectOnly: { command: PROJECT_COMMAND_EXPR } },
		});

		const result = loadMcpConfig({
			agentDir: root.agentDir,
			cwd: root.cwd,
			env: { PROJECT_COMMAND: "trusted-command" },
			projectTrusted: true,
		});

		expect(result.servers.projectOnly).toMatchObject({
			source: "project",
			state: "enabled",
			config: { command: "trusted-command" },
		});
	});
});

function makeRoot(): { agentDir: string; cwd: string } {
	const root = mkdtempSync(join(tmpdir(), "senpi-mcp-config-"));
	const agentDir = join(root, "agent");
	const cwd = join(root, "project");
	mkdirSync(agentDir, { recursive: true });
	mkdirSync(join(cwd, ".senpi"), { recursive: true });
	return { agentDir, cwd };
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
