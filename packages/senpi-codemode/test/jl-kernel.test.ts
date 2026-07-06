import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
	it("ships the stdlib-only prelude asset", async () => {
		await expect(
			access(join(import.meta.dirname, "..", "src", "kernels", "jl", "prelude.jl")),
		).resolves.toBeUndefined();
	});

	it.skipIf(!hasJulia())("persists state, displays last expression, and calls one host tool", async () => {
		const root = await mkdtemp(join(tmpdir(), "senpi-jl-kernel-"));
		try {
			const kernel = JuliaKernel.start({
				cwd: root,
				sessionId: "jl-live",
				connection: { port: 39102, token: "live-token" },
			});
			try {
				await kernel.run({ cellId: "set", code: "answer = 41", timeoutMs: 8_000 });
				const persisted = await kernel.run({ cellId: "get", code: "answer + 1", timeoutMs: 8_000 });
				expect(persisted).toMatchObject({ ok: true, valueRepr: "42" });
				await kernel.reset();
				const reset = await kernel.run({ cellId: "reset", code: "@isdefined(answer)", timeoutMs: 8_000 });
				expect(reset).toMatchObject({ ok: true, valueRepr: "false" });
				await kernel.run({ cellId: "set-again", code: "answer = 41", timeoutMs: 8_000 });

				const pending = kernel.run({
					cellId: "tool",
					code: 'tool.echo(Dict("value" => answer))',
					timeoutMs: 8_000,
				});
				const call = await kernel.nextToolCall();
				kernel.deliverToolReply({ type: "tool-reply", callId: call.callId, ok: true, value: "julia-tool-ok" });
				await expect(pending).resolves.toMatchObject({ ok: true, valueRepr: '"julia-tool-ok"' });
			} finally {
				await kernel.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
