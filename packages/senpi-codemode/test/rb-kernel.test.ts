import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startBridgeServer } from "../src/bridge/http-server.ts";
import type { KernelToHostMessage } from "../src/bridge/protocol.ts";
import { RubyKernel } from "../src/kernels/rb/kernel.ts";

function hasRuby(): boolean {
	try {
		execFileSync("ruby", ["--version"], { stdio: "ignore", timeout: 3_000 });
		return true;
	} catch {
		return false;
	}
}

function runnerProcessIds(runnerPath: string): Set<string> {
	try {
		const output = execFileSync("pgrep", ["-fl", escapeRegExp(runnerPath)], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 3_000,
		});
		return new Set(
			output
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => line.split(/\s+/u)[0])
				.filter((pid) => pid !== undefined),
		);
	} catch {
		return new Set();
	}
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("RubyKernel", () => {
	const runnerPath = join(import.meta.dirname, "..", "src", "kernels", "rb", "runner.rb");

	it("routes tool calls through the authenticated loopback bridge contract", async () => {
		const prelude = await readFile(join(import.meta.dirname, "..", "src", "kernels", "rb", "prelude.rb"), "utf8");
		const runner = await readFile(runnerPath, "utf8");
		expect(prelude).toContain('URI("http://127.0.0.1:#{port}#{path}")');
		expect(prelude).toContain('request["authorization"] = "Bearer #{token}"');
		expect(prelude).toContain('"callId" => "rb-#{Process.pid}-#{rand(1_000_000)}"');
		expect(prelude).toContain('"toolName" => name');
		expect(runner).not.toContain('"type" => "tool-call"');
	});

	it("ships the stdlib-only prelude asset", async () => {
		await expect(
			access(join(import.meta.dirname, "..", "src", "kernels", "rb", "prelude.rb")),
		).resolves.toBeUndefined();
	});

	it.skipIf(!hasRuby())(
		"persists state, displays last expression, and calls one host tool through the bridge",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "senpi-rb-kernel-"));
			const toolCalls: unknown[] = [];
			const server = await startBridgeServer({
				token: "live-token",
				onCall: async (request) => {
					toolCalls.push({ callId: request.callId, toolName: request.toolName, args: request.args });
					return "ruby-tool-ok";
				},
				onEmit: async () => {},
				onCompletion: async () => {
					throw new Error("unexpected completion");
				},
			});
			try {
				const kernel = RubyKernel.start({
					cwd: root,
					sessionId: "rb-live",
					connection: { port: server.port, token: server.token },
				});
				try {
					await kernel.run({ cellId: "set", code: "$answer = 41", timeoutMs: 3_000 });
					const persisted = await kernel.run({ cellId: "get", code: "$answer + 1", timeoutMs: 3_000 });
					expect(persisted).toMatchObject({ ok: true, valueRepr: "42" });
					await kernel.reset();
					const reset = await kernel.run({ cellId: "reset", code: "defined?($answer)", timeoutMs: 3_000 });
					expect(reset).toMatchObject({ ok: true });
					if (reset.ok) expect(reset.valueRepr).toBeUndefined();
					await kernel.run({ cellId: "set-again", code: "$answer = 41", timeoutMs: 3_000 });

					await expect(
						kernel.run({ cellId: "tool", code: "tool.echo({value: $answer})", timeoutMs: 3_000 }),
					).resolves.toMatchObject({ ok: true, valueRepr: '"ruby-tool-ok"' });
					expect(toolCalls).toMatchObject([{ toolName: "echo", args: { value: 41 } }]);
				} finally {
					await kernel.close();
				}
			} finally {
				await server.close();
				await rm(root, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!hasRuby())("matches helper, status, markdown, and auto-display contracts", async () => {
		const root = await mkdtemp(join(tmpdir(), "senpi-rb-kernel-parity-"));
		const localRoot = join(root, "local");
		const messages: KernelToHostMessage[] = [];
		const toolCalls: { readonly toolName: string; readonly args: unknown }[] = [];
		const server = await startBridgeServer({
			token: "parity-token",
			onCall: async (request) => {
				toolCalls.push({ toolName: request.toolName, args: request.args });
				return "agent-result";
			},
			onEmit: async () => {},
			onCompletion: async () => "unused",
		});
		try {
			const kernel = RubyKernel.start({
				cwd: root,
				sessionId: "rb-parity",
				connection: { port: server.port, token: server.token, localRoots: { local: localRoot } },
				onMessage: (message) => messages.push(message),
			});
			try {
				// Given: a live kernel with a local:// root and loopback bridge.
				// When: cells exercise the documented Ruby helper and REPL surface.
				const literal = await kernel.run({ cellId: "literal", code: "1 + 1", timeoutMs: 3_000 });
				const assignment = await kernel.run({ cellId: "assignment", code: "answer = 5", timeoutMs: 3_000 });
				const nilValue = await kernel.run({ cellId: "nil", code: "nil", timeoutMs: 3_000 });
				const environment = await kernel.run({
					cellId: "environment",
					code: 'env("SENPI_RB_PARITY", "value"); env("SENPI_RB_PARITY")',
					timeoutMs: 3_000,
				});
				const agent = await kernel.run({
					cellId: "agent",
					code: 'write("local://nested/value.txt", "hello"); agent("summarize")',
					timeoutMs: 3_000,
				});
				const output = await kernel.run({ cellId: "output", code: 'output("st_123")', timeoutMs: 3_000 });
				await kernel.run({
					cellId: "markdown",
					code: 'display({ type: "markdown", text: "# Heading" })',
					timeoutMs: 3_000,
				});

				// Then: only eligible final expressions auto-display and helpers use the bridge contract.
				expect(literal).toMatchObject({ ok: true, valueRepr: "2" });
				expect(assignment).toMatchObject({ ok: true });
				if (assignment.ok) expect(assignment.valueRepr).toBeUndefined();
				expect(nilValue).toMatchObject({ ok: true });
				if (nilValue.ok) expect(nilValue.valueRepr).toBeUndefined();
				expect(environment).toMatchObject({ ok: true, valueRepr: '"value"' });
				expect(agent).toMatchObject({ ok: true, valueRepr: '"agent-result"' });
				expect(output).toMatchObject({ ok: true, valueRepr: '"agent-result"' });
				expect(toolCalls).toContainEqual({ toolName: "__agent__", args: { prompt: "summarize", agent: "task" } });
				expect(toolCalls).toContainEqual({ toolName: "__output__", args: { ids: ["st_123"], format: "raw" } });
				expect(await readFile(join(localRoot, "nested", "value.txt"), "utf8")).toBe("hello");
				expect(messages.some((message) => message.type === "status" && message.event.op === "env")).toBe(true);
				expect(messages.some((message) => message.type === "status" && message.event.op === "write")).toBe(true);
				expect(messages).toContainEqual({
					type: "display",
					mimeType: "text/markdown",
					dataBase64: Buffer.from("# Heading", "utf8").toString("base64"),
				});
			} finally {
				await kernel.close();
			}
		} finally {
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
	});

	it.skipIf(!hasRuby())("does not leave runner.rb alive after a timeout restart and close", async () => {
		const root = await mkdtemp(join(tmpdir(), "senpi-rb-kernel-cleanup-"));
		const server = await startBridgeServer({
			token: "live-token",
			onCall: async () => "unexpected",
			onEmit: async () => {},
			onCompletion: async () => {
				throw new Error("unexpected completion");
			},
		});
		const before = runnerProcessIds(runnerPath);
		try {
			const kernel = RubyKernel.start({
				cwd: root,
				sessionId: "rb-cleanup",
				connection: { port: server.port, token: server.token },
			});
			try {
				const timedOut = await kernel.run({ cellId: "timeout", code: "sleep 10", timeoutMs: 50 });
				expect(timedOut).toMatchObject({
					ok: false,
					error: { message: "Cell timed out after 50ms" },
				});
			} finally {
				await kernel.close();
			}

			const after = runnerProcessIds(runnerPath);
			for (const pid of before) after.delete(pid);
			expect([...after]).toEqual([]);
		} finally {
			await server.close();
			await rm(root, { recursive: true, force: true });
		}
	});
});
