import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startBridgeServer } from "../src/bridge/http-server.ts";
import type { KernelToHostMessage } from "../src/bridge/protocol.ts";
import { JuliaKernel } from "../src/kernels/jl/kernel.ts";

function hasJulia(): boolean {
	try {
		execFileSync("julia", ["--version"], { stdio: "ignore", timeout: 3_000 });
		return true;
	} catch {
		return false;
	}
}

describe("JuliaKernel", () => {
	it("routes tool calls through the authenticated loopback bridge contract", async () => {
		const runner = await readFile(join(import.meta.dirname, "..", "src", "kernels", "jl", "runner.jl"), "utf8");
		expect(runner).toContain('connect(ip"127.0.0.1", port)');
		expect(runner).toContain('"POST " * path * " HTTP/1.1"');
		expect(runner).toContain('"Authorization: Bearer " * string(token)');
		expect(runner).toContain('"callId" => "jl-" * string(time_ns())');
		expect(runner).toContain('"toolName" => name');
		expect(runner).not.toContain('"type" => "tool-call"');
	});

	it("ships the stdlib-only prelude asset", async () => {
		await expect(
			access(join(import.meta.dirname, "..", "src", "kernels", "jl", "prelude.jl")),
		).resolves.toBeUndefined();
	});

	it.skipIf(!hasJulia())(
		"persists state, displays last expression, and calls one host tool through the bridge",
		async () => {
			const root = await mkdtemp(join(tmpdir(), "senpi-jl-kernel-"));
			const toolCalls: unknown[] = [];
			const server = await startBridgeServer({
				token: "live-token",
				onCall: async (request) => {
					toolCalls.push({ callId: request.callId, toolName: request.toolName, args: request.args });
					return "julia-tool-ok";
				},
				onEmit: async () => {},
				onCompletion: async () => {
					throw new Error("unexpected completion");
				},
			});
			try {
				const kernel = JuliaKernel.start({
					cwd: root,
					sessionId: "jl-live",
					connection: { port: server.port, token: server.token },
				});
				try {
					// The first cell after start() — and the first after reset(), which
					// restarts the subprocess — pays Julia's full cold boot (interpreter
					// startup + prelude/runner compilation), which routinely exceeds 8s on
					// a loaded CI runner. A cell timeout fires restartProcess(), so a tight
					// cold-start budget doesn't just fail that cell: it wedges the ones
					// after it too (observed as flaky "Kernel is closed" / ok:false on
					// "get"). Cold-start cells get a boot-sized budget; warm cells keep 8s
					// so steady-state responsiveness stays covered.
					const coldStartTimeoutMs = 60_000;
					await kernel.run({ cellId: "set", code: "answer = 41", timeoutMs: coldStartTimeoutMs });
					const persisted = await kernel.run({ cellId: "get", code: "answer + 1", timeoutMs: 8_000 });
					expect(persisted).toMatchObject({ ok: true, valueRepr: "42" });
					await kernel.reset();
					const reset = await kernel.run({
						cellId: "reset",
						code: "@isdefined(answer)",
						timeoutMs: coldStartTimeoutMs,
					});
					expect(reset).toMatchObject({ ok: true, valueRepr: "false" });
					await kernel.run({ cellId: "set-again", code: "answer = 41", timeoutMs: 8_000 });

					await expect(
						kernel.run({
							cellId: "tool",
							code: 'tool.echo(Dict("value" => answer))',
							timeoutMs: 8_000,
						}),
					).resolves.toMatchObject({ ok: true, valueRepr: '"julia-tool-ok"' });
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
	it.skipIf(!hasJulia())("matches helper, status, markdown, and auto-display contracts", async () => {
		const root = await mkdtemp(join(tmpdir(), "senpi-jl-kernel-parity-"));
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
			const kernel = JuliaKernel.start({
				cwd: root,
				sessionId: "jl-parity",
				connection: { port: server.port, token: server.token, localRoots: { local: localRoot } },
				onMessage: (message) => messages.push(message),
			});
			try {
				const coldStartTimeoutMs = 60_000;
				const warmTimeoutMs = 8_000;
				// Given: a live kernel with a local:// root and loopback bridge.
				// When: cells exercise the documented Julia helper and REPL surface.
				const literal = await kernel.run({ cellId: "literal", code: "1 + 1", timeoutMs: coldStartTimeoutMs });
				const assignment = await kernel.run({ cellId: "assignment", code: "answer = 5", timeoutMs: warmTimeoutMs });
				const nilValue = await kernel.run({ cellId: "nil", code: "nothing", timeoutMs: warmTimeoutMs });
				const environment = await kernel.run({
					cellId: "environment",
					code: 'env("SENPI_JL_PARITY", "value"); env("SENPI_JL_PARITY")',
					timeoutMs: warmTimeoutMs,
				});
				const agent = await kernel.run({
					cellId: "agent",
					code: 'write("local://nested/value.txt", "hello"); agent("summarize")',
					timeoutMs: warmTimeoutMs,
				});
				const output = await kernel.run({ cellId: "output", code: 'output("st_123")', timeoutMs: warmTimeoutMs });
				await kernel.run({
					cellId: "markdown",
					code: 'display(Dict("type" => "markdown", "text" => "# Heading"))',
					timeoutMs: warmTimeoutMs,
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
});
