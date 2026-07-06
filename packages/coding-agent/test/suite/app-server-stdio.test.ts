import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { restoreStdout } from "../../src/core/output-guard.ts";
import { ServerCore } from "../../src/modes/app-server/server/server-core.ts";
import { startStdioTransport } from "../../src/modes/app-server/transports/stdio.ts";

type WriteCallback = (error?: Error | null) => void;

interface CapturedProcessOutput {
	readonly stdout: readonly string[];
	readonly stderr: readonly string[];
	restore(): void;
}

function initializeFrame(id: number): string {
	return `${JSON.stringify({ id, method: "initialize", params: { clientInfo: { name: "qa", version: "0.0.1" } } })}\n`;
}

function createCapturedProcessOutput(): CapturedProcessOutput {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const originalStdoutWrite = process.stdout.write;
	const originalStderrWrite = process.stderr.write;

	function writeStdout(
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean {
		stdout.push(String(chunk));
		const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		done?.();
		return true;
	}

	function writeStderr(
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | WriteCallback,
		callback?: WriteCallback,
	): boolean {
		stderr.push(String(chunk));
		const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		done?.();
		return true;
	}

	process.stdout.write = writeStdout;
	process.stderr.write = writeStderr;

	return {
		stdout,
		stderr,
		restore: () => {
			process.stdout.write = originalStdoutWrite;
			process.stderr.write = originalStderrWrite;
		},
	};
}

describe("app-server stdio transport", () => {
	afterEach(() => {
		restoreStdout();
	});

	it("opens exactly one stdio connection when a client stream starts", async () => {
		// Given: one stdin stream attached to a server core.
		const stdin = new PassThrough();
		const core = new ServerCore();

		// When: stdio transport starts and a second start is attempted.
		const transport = startStdioTransport({ core, stdin });

		// Then: the single stdio connection is present and a second stdio client is rejected.
		expect(core.getConnection(transport.connectionId)?.transportKind).toBe("stdio");
		expect(() => startStdioTransport({ core, stdin: new PassThrough() })).toThrow("already active");

		await transport.close("test complete");
	});

	it("writes each server response as one newline-terminated NDJSON frame", async () => {
		// Given: a stdio stream connected to the server core.
		const output = createCapturedProcessOutput();
		const stdin = new PassThrough();
		const core = new ServerCore({ version: "2026.7.2", codexHome: "/tmp/senpi-stdio-test" });
		const transport = startStdioTransport({ core, stdin });

		try {
			// When: the client sends initialize over stdin.
			stdin.end(initializeFrame(1));
			await transport.drain();

			// Then: stdout receives exactly one parseable response line ending in LF.
			expect(output.stdout).toHaveLength(1);
			const line = output.stdout[0];
			expect(line?.endsWith("\n")).toBe(true);
			expect(JSON.parse(line ?? "")).toMatchObject({ id: 1, result: { codexHome: "/tmp/senpi-stdio-test" } });

			await transport.close("test complete");
		} finally {
			restoreStdout();
			output.restore();
		}
	});

	it("triggers graceful server shutdown when stdin ends", async () => {
		// Given: a stdio transport with a shutdown callback.
		const stdin = new PassThrough();
		const shutdownReasons: string[] = [];
		let transport: ReturnType<typeof startStdioTransport> | undefined;
		const shutdown = new Promise<string>((resolve) => {
			transport = startStdioTransport({
				core: new ServerCore(),
				stdin,
				onShutdown: (reason: string) => {
					shutdownReasons.push(reason);
					resolve(reason);
				},
			});
		});

		try {
			// When: the client closes stdin.
			stdin.end();
			await expect(shutdown).resolves.toBe("stdin ended");

			// Then: the transport requests graceful shutdown once.
			expect(shutdownReasons).toEqual(["stdin ended"]);
		} finally {
			await transport?.close("test cleanup");
		}
	});

	it("keeps stdout as parseable NDJSON while session logging writes concurrently", async () => {
		// Given: stdout and stderr are captured before app-server takes over stdout.
		const output = createCapturedProcessOutput();

		try {
			const stdin = new PassThrough();
			const transport = startStdioTransport({
				core: new ServerCore({ version: "2026.7.2", codexHome: "/tmp/senpi-stdio-test" }),
				stdin,
			});

			// When: app-server replies while a session logger writes to process.stdout.
			process.stdout.write("session log must move to stderr\n");
			stdin.end(initializeFrame(7));
			await transport.drain();

			// Then: every stdout line is valid JSON, while the log went to stderr.
			for (const line of output.stdout.join("").split("\n").filter(Boolean)) {
				expect(JSON.parse(line)).toMatchObject({ id: 7 });
			}
			expect(output.stderr.join("")).toContain("session log must move to stderr");

			await transport.close("test complete");
		} finally {
			restoreStdout();
			output.restore();
		}
	});
});

describe("app-server stdio mode process", () => {
	it("responds to initialize when spawned through the real CLI entry", async () => {
		// Given: an isolated real app-server process using stdio transport.
		const root = await mkdtemp(join(tmpdir(), "senpi-app-server-stdio-process-"));
		const child = spawn("npx", ["tsx", "src/cli.ts", "app-server"], {
			cwd: process.cwd(),
			env: {
				...process.env,
				SENPI_CODING_AGENT_DIR: join(root, "agent"),
				SENPI_CODING_AGENT_SESSION_DIR: join(root, "sessions"),
				PI_OFFLINE: "1",
			},
			stdio: ["pipe", "pipe", "pipe"],
		});

		try {
			// When: the client sends initialize over stdin.
			const line = readStdoutLine(child, 15_000);
			child.stdin.end(initializeFrame(1));

			// Then: the process writes a parseable initialize response before the deadline.
			const parsed: unknown = JSON.parse(await line);
			expect(parsed).toMatchObject({ id: 1, result: { userAgent: expect.any(String) } });
			await expect(waitForExit(child, 15_000)).resolves.toBe(0);
		} finally {
			child.kill("SIGKILL");
			await rm(root, { recursive: true, force: true });
		}
	});
});

function readStdoutLine(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let buffer = "";
		const timeout = setTimeout(() => reject(new Error(`stdout line not observed within ${timeoutMs}ms`)), timeoutMs);
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			clearTimeout(timeout);
			resolve(buffer.slice(0, newline));
		});
		child.once("exit", (code) => {
			clearTimeout(timeout);
			reject(new Error(`app-server exited before stdout response: ${String(code)}`));
		});
	});
}

function waitForExit(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<number | null> {
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`process exit not observed within ${timeoutMs}ms`)), timeoutMs);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			resolve(code);
		});
	});
}
