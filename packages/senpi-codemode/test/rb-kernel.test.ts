import { execFileSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RubyKernel } from "../src/kernels/rb/kernel.ts";

function hasRuby(): boolean {
	try {
		execFileSync("ruby", ["--version"], { stdio: "ignore", timeout: 3_000 });
		return true;
	} catch {
		return false;
	}
}

describe("RubyKernel", () => {
	it("ships the stdlib-only prelude asset", async () => {
		await expect(
			access(join(import.meta.dirname, "..", "src", "kernels", "rb", "prelude.rb")),
		).resolves.toBeUndefined();
	});

	it.skipIf(!hasRuby())("persists state, displays last expression, and calls one host tool", async () => {
		const root = await mkdtemp(join(tmpdir(), "senpi-rb-kernel-"));
		try {
			const toolCalls: unknown[] = [];
			const kernel = RubyKernel.start({
				cwd: root,
				sessionId: "rb-live",
				connection: { port: 39101, token: "live-token" },
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

				const pending = kernel.run({ cellId: "tool", code: "tool.echo({value: $answer})", timeoutMs: 3_000 });
				const call = await kernel.nextToolCall();
				toolCalls.push(call);
				kernel.deliverToolReply({ type: "tool-reply", callId: call.callId, ok: true, value: "ruby-tool-ok" });
				await expect(pending).resolves.toMatchObject({ ok: true, valueRepr: '"ruby-tool-ok"' });
				expect(toolCalls).toHaveLength(1);
			} finally {
				await kernel.close();
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
