import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseDaemonPidFile, processMatchesPidFile } from "../../src/modes/app-server/daemon/process.ts";
import { createDaemonPaths, withDaemonStateLock } from "../../src/modes/app-server/daemon.ts";

const roots: string[] = [];
const packageRoot = resolve(import.meta.dirname, "../..");

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("app-server daemon state", () => {
	it("rejects malformed pidfiles and detects start-time mismatches", async () => {
		// Given: malformed, valid, and stale app-server pidfile payloads.
		const malformed = parseDaemonPidFile("{");
		const valid = parseDaemonPidFile('{"pid":123,"processStartTime":"Mon Jul  2 10:00:00 2026"}');

		// When: the parsed records are compared with a process start-time reader.
		const matches = valid ? await processMatchesPidFile(valid, async () => "Mon Jul  2 10:00:00 2026") : false;
		const stale = valid ? await processMatchesPidFile(valid, async () => "Mon Jul  2 10:00:01 2026") : true;

		// Then: only the valid pidfile with the exact process start time is accepted.
		expect(malformed).toBeUndefined();
		expect(matches).toBe(true);
		expect(stale).toBe(false);
	});

	it("serializes daemon commands with the state lock", async () => {
		// Given: two daemon operations sharing one state directory.
		const root = await scratchRoot("senpi-daemon-lock-");
		const paths = createDaemonPaths(join(root, "agent"));
		const events: string[] = [];
		const releaseFirst = createDeferred<void>();
		const first = withDaemonStateLock(paths, async () => {
			events.push("first-enter");
			await releaseFirst.promise;
			events.push("first-exit");
			return "first";
		});
		await eventually(() => expect(events).toEqual(["first-enter"]));

		// When: a second operation starts before the first releases the lock.
		const second = withDaemonStateLock(paths, async () => {
			events.push("second-enter");
			return "second";
		});
		releaseFirst.resolve();
		const results = await Promise.all([first, second]);

		// Then: the second operation enters only after the first exits.
		expect(results).toEqual(["first", "second"]);
		expect(events).toEqual(["first-enter", "first-exit", "second-enter"]);
	});
});

describe.sequential("app-server daemon CLI", () => {
	it("starts, reports status, attaches idempotently, and stops a managed daemon", async () => {
		// Given: a scratch agent directory and a non-default loopback port.
		const root = await scratchRoot("senpi-daemon-cli-");
		const agentDir = join(root, "agent");
		const port = await freePort();
		const listen = `ws://127.0.0.1:${port}`;

		try {
			// When: daemon commands are driven through the real CLI surface.
			const started = await runDaemonCli(agentDir, ["start", "--listen", listen]);
			const pidFile = parseDaemonPidFile(
				await readFile(join(agentDir, "app-server-daemon", "app-server.pid"), "utf8"),
			);
			const settings = JSON.parse(await readFile(join(agentDir, "app-server-daemon", "settings.json"), "utf8"));
			const pidMatches = pidFile ? await processMatchesPidFile(pidFile, readProcessStartTime) : false;
			const status = await runDaemonCli(agentDir, ["status"]);
			const attached = await runDaemonCli(agentDir, ["start", "--listen", listen]);
			const stopped = await runDaemonCli(agentDir, ["stop"]);
			const stoppedStatus = await runDaemonCli(agentDir, ["status"]);

			// Then: each command emits one JSON object and the pidfile records the listener process start time.
			expect(started.json).toMatchObject({ status: "started", listen });
			expect(typeof started.json.pid).toBe("number");
			expect(pidFile?.pid).toBe(started.json.pid);
			expect(pidMatches).toBe(true);
			expect(settings).toEqual({ listen: { kind: "ws", url: listen, host: "127.0.0.1", port } });
			expect(status.json).toMatchObject({ status: "running", pid: started.json.pid, listen });
			expect(attached.json).toMatchObject({ status: "already-running", pid: started.json.pid, listen });
			expect(stopped.json).toEqual({ status: "stopped" });
			expect(stoppedStatus.json).toEqual({ status: "not-running" });
		} finally {
			await runDaemonCli(agentDir, ["stop"]).catch(() => undefined);
		}
	}, 90_000);
});

type DaemonCliResult = {
	readonly json: Record<string, unknown>;
	readonly stderr: string;
};

function createDeferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T | PromiseLike<T>) => void;
} {
	let resolvePromise: (value: T | PromiseLike<T>) => void = () => {};
	const promise = new Promise<T>((resolveDeferred) => {
		resolvePromise = resolveDeferred;
	});
	return { promise, resolve: resolvePromise };
}

async function scratchRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}

function freePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("expected TCP address"));
				return;
			}
			const port = address.port;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolvePort(port);
			});
		});
	});
}

function runDaemonCli(agentDir: string, daemonArgs: readonly string[]): Promise<DaemonCliResult> {
	return new Promise((resolveResult, reject) => {
		const child = spawn("npx", ["tsx", "src/cli.ts", "app-server", "daemon", ...daemonArgs], {
			cwd: packageRoot,
			env: {
				...process.env,
				PI_OFFLINE: "1",
				SENPI_CODING_AGENT_DIR: agentDir,
				SENPI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"),
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`daemon command timed out: ${daemonArgs.join(" ")}`));
		}, 60_000);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.once("error", (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once("close", (code) => {
			clearTimeout(timeout);
			if (code !== 0) {
				reject(new Error(`daemon command failed (${code}): ${daemonArgs.join(" ")}\n${stderr}`));
				return;
			}
			const lines = stdout.trim().split("\n").filter(Boolean);
			expect(lines).toHaveLength(1);
			const parsed: unknown = JSON.parse(lines[0] ?? "");
			expectRecord(parsed);
			resolveResult({ json: parsed, stderr });
		});
	});
}

async function readProcessStartTime(pid: number): Promise<string | undefined> {
	return await new Promise((resolveStartTime, reject) => {
		execFile("ps", ["-o", "lstart=", "-p", String(pid)], (error, stdout) => {
			if (error) {
				resolveStartTime(undefined);
				return;
			}
			resolveStartTime(stdout.trim() || undefined);
		}).once("error", reject);
	});
}

async function eventually(assertion: () => void | Promise<void>): Promise<void> {
	const deadline = Date.now() + 2_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			await assertion();
			return;
		} catch (error: unknown) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	if (lastError instanceof Error) {
		throw lastError;
	}
	throw new Error("condition was not met");
}

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	expect(Array.isArray(value)).toBe(false);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected record");
	}
}
