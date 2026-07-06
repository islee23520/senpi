import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import type { KernelToHostMessage } from "../../../src/bridge/protocol.ts";
import type { SubprocessSpawn } from "../../../src/kernels/shared/subprocess-kernel.ts";
import { SubprocessKernel } from "../../../src/kernels/shared/subprocess-kernel.ts";

class FakeProc extends EventEmitter {
	readonly stdin = { writes: [] as string[], write: (chunk: string) => this.stdin.writes.push(chunk) };
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly killedSignals: string[] = [];

	kill(signal?: NodeJS.Signals): boolean {
		this.killedSignals.push(signal ?? "SIGTERM");
		return true;
	}
}

describe("SubprocessKernel", () => {
	it("sends bridge init over stdin without leaking port or token into argv", async () => {
		const fake = new FakeProc();
		const spawnCalls: { command: string; args: readonly string[] }[] = [];
		const spawn: SubprocessSpawn = (command, args) => {
			spawnCalls.push({ command, args });
			return fake;
		};

		const kernel = new SubprocessKernel({
			command: "ruby",
			args: ["runner.rb"],
			spawn,
			sessionId: "session-1",
			connection: { port: 39001, token: "secret-token" },
		});

		expect(spawnCalls).toEqual([{ command: "ruby", args: ["runner.rb"] }]);
		expect(spawnCalls[0]?.args.join(" ")).not.toContain("secret-token");
		expect(spawnCalls[0]?.args.join(" ")).not.toContain("39001");
		expect(JSON.parse(fake.stdin.writes[0] ?? "{}")).toEqual({
			type: "init",
			sessionId: "session-1",
			connection: { port: 39001, token: "secret-token" },
		});

		await kernel.close();
	});

	it("runs queued cells and round-trips tool replies", async () => {
		const fake = new FakeProc();
		const messages: KernelToHostMessage[] = [];
		const kernel = new SubprocessKernel({
			command: "ruby",
			args: ["runner.rb"],
			spawn: () => fake,
			sessionId: "session-1",
			connection: { port: 39001, token: "secret-token" },
			onMessage: (message) => messages.push(message),
		});

		const run = kernel.run({ cellId: "cell-1", code: "tool.read(path: 'x')", timeoutMs: 1_000 });
		fake.stdout.write(
			`${JSON.stringify({ type: "tool-call", callId: "call-1", toolName: "read", args: { path: "x" } })}\n`,
		);
		const call = await kernel.nextToolCall();
		expect(call.toolName).toBe("read");

		kernel.deliverToolReply({ type: "tool-reply", callId: "call-1", ok: true, value: "from-host" });
		expect(JSON.parse(fake.stdin.writes.at(-1) ?? "{}")).toEqual({
			type: "tool-reply",
			callId: "call-1",
			ok: true,
			value: "from-host",
		});

		fake.stdout.write(
			`${JSON.stringify({ type: "result", cellId: "cell-1", ok: true, valueRepr: '"from-host"', durationMs: 4 })}\n`,
		);
		await expect(run).resolves.toMatchObject({ ok: true, valueRepr: '"from-host"' });
		expect(messages).toContainEqual({ type: "tool-call", callId: "call-1", toolName: "read", args: { path: "x" } });

		await kernel.close();
	});

	it("reset respawns the subprocess and re-sends init over stdin", async () => {
		const first = new FakeProc();
		const second = new FakeProc();
		const procs = [first, second];
		const kernel = new SubprocessKernel({
			command: "ruby",
			args: ["runner.rb"],
			spawn: () => {
				const proc = procs.shift();
				if (!proc) throw new Error("unexpected spawn");
				return proc;
			},
			sessionId: "session-1",
			connection: { port: 39001, token: "secret-token" },
		});

		await kernel.reset();

		expect(procs).toHaveLength(0);
		expect(first.killedSignals).toEqual(["SIGTERM"]);
		expect(second.stdin.writes).toHaveLength(1);
		expect(JSON.parse(second.stdin.writes[0] ?? "{}")).toMatchObject({ type: "init", sessionId: "session-1" });
		await kernel.close();
	});
});
