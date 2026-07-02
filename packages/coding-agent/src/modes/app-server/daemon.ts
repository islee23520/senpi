import { spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as properLockfile from "proper-lockfile";
import { getAgentDir } from "../../config.ts";
import {
	cleanupState,
	pollProbe,
	probeListen,
	readSettings,
	runningOutput,
	runningUnmanagedOutput,
} from "./daemon/probe.ts";
import {
	type DaemonPidFile,
	parseDaemonPidFile,
	processMatchesPidFile,
	readProcessStartTime,
	stopValidatedPid,
	waitForGone,
	waitForStartTime,
} from "./daemon/process.ts";
import type { AppServerDaemonCommandOptions, AppServerListen } from "./index.ts";

export interface DaemonPaths {
	readonly dir: string;
	readonly pidFile: string;
	readonly lockFile: string;
	readonly settingsFile: string;
	readonly stderrLog: string;
	readonly tokenFile: string;
}

type DaemonOutput = Readonly<Record<string, string | number | undefined>>;

const lockOptions = { stale: 60_000, retries: { retries: 100, minTimeout: 20, maxTimeout: 100 } } as const;

export function createDaemonPaths(agentDir = getAgentDir()): DaemonPaths {
	const dir = join(agentDir, "app-server-daemon");
	return {
		dir,
		pidFile: join(dir, "app-server.pid"),
		lockFile: join(dir, "daemon.lock"),
		settingsFile: join(dir, "settings.json"),
		stderrLog: join(dir, "stderr.log"),
		tokenFile: join(agentDir, "app-server", "ws-token"),
	};
}

export async function withDaemonStateLock<T>(paths: DaemonPaths, task: () => Promise<T>): Promise<T> {
	await mkdir(paths.dir, { recursive: true });
	const release = await properLockfile.lock(paths.dir, { ...lockOptions, lockfilePath: paths.lockFile });
	try {
		return await task();
	} finally {
		await release();
	}
}

export async function runAppServerDaemonCommand(options: AppServerDaemonCommandOptions): Promise<void> {
	const paths = createDaemonPaths();
	const output = await withDaemonStateLock(paths, async () => {
		try {
			return await runLockedDaemonCommand(options, paths);
		} catch (error: unknown) {
			process.exitCode = 1;
			return { status: "error", message: error instanceof Error ? error.message : String(error) };
		}
	});
	process.stdout.write(`${JSON.stringify(output)}\n`);
}

async function runLockedDaemonCommand(
	options: AppServerDaemonCommandOptions,
	paths: DaemonPaths,
): Promise<DaemonOutput> {
	const settings = await readSettings(paths);
	const listen = options.verb === "start" ? options.listen : (settings?.listen ?? options.listen);
	switch (options.verb) {
		case "start":
			return startDaemon(paths, listen);
		case "stop":
			return stopDaemon(paths, listen);
		case "status":
			return statusDaemon(paths, listen);
		case "restart": {
			const restartListen = settings?.listen ?? options.listen;
			await stopDaemon(paths, restartListen);
			return startDaemon(paths, restartListen);
		}
	}
}

async function startDaemon(paths: DaemonPaths, listen: AppServerListen): Promise<DaemonOutput> {
	const firstProbe = await probeListen(paths, listen, 2_000);
	if (firstProbe) {
		const pidFile = await readPidFile(paths);
		const pid = pidFile && (await processMatchesPidFile(pidFile)) ? pidFile.pid : undefined;
		if (pid !== undefined) return runningOutput("already-running", pid, listen, firstProbe);
		return { status: "already-running", listen: listen.url, version: firstProbe };
	}
	const pidFile = await readPidFile(paths);
	if (pidFile && (await processMatchesPidFile(pidFile))) {
		const lateProbe = await pollProbe(paths, listen, 10_000);
		if (lateProbe) return runningOutput("already-running", pidFile.pid, listen, lateProbe);
		throw new Error(`managed daemon pid ${pidFile.pid} did not answer initialize`);
	}
	const pid = await spawnDaemon(paths, listen);
	const ready = await pollProbe(paths, listen, 10_000);
	if (!ready) {
		await stopValidatedPid({ pid, processStartTime: (await readProcessStartTime(pid)) ?? "" }, "SIGTERM");
		await cleanupState(paths, listen);
		throw new Error("spawned daemon did not answer initialize within 10s");
	}
	return { status: "started", pid, listen: listen.url };
}

async function stopDaemon(paths: DaemonPaths, listen: AppServerListen): Promise<DaemonOutput> {
	const pidFile = await readPidFile(paths);
	if (!pidFile) {
		if (!(await probeListen(paths, listen, 2_000))) await cleanupState(paths, listen);
		return { status: "not-running" };
	}
	if (!(await processMatchesPidFile(pidFile))) {
		await cleanupState(paths, listen);
		return { status: "not-running" };
	}
	await stopValidatedPid(pidFile, "SIGTERM");
	if (await processMatchesPidFile(pidFile)) {
		await stopValidatedPid(pidFile, "SIGKILL");
	}
	await waitForGone(pidFile, 10_000);
	await cleanupState(paths, listen);
	return { status: "stopped" };
}

async function statusDaemon(paths: DaemonPaths, listen: AppServerListen): Promise<DaemonOutput> {
	const probe = await probeListen(paths, listen, 2_000);
	const pidFile = await readPidFile(paths);
	const pidMatches = pidFile ? await processMatchesPidFile(pidFile) : false;
	if (probe && pidFile && pidMatches) return runningOutput("running", pidFile.pid, listen, probe);
	if (probe) return runningUnmanagedOutput(listen, probe);
	if (pidFile && !pidMatches) await cleanupState(paths, listen);
	return { status: "not-running" };
}

async function spawnDaemon(paths: DaemonPaths, listen: AppServerListen): Promise<number> {
	const stderr = await open(paths.stderrLog, "a");
	try {
		const child = spawn(
			process.execPath,
			[...process.execArgv, resolveCliMainPath(), "app-server", "--listen", listen.url],
			{
				detached: true,
				env: process.env,
				stdio: ["ignore", "ignore", stderr.fd],
			},
		);
		child.unref();
		if (child.pid === undefined) throw new Error("failed to spawn daemon process");
		const startTime = await waitForStartTime(child.pid, 2_000);
		await writeFile(paths.pidFile, `${JSON.stringify({ pid: child.pid, processStartTime: startTime })}\n`, {
			mode: 0o600,
		});
		await writeFile(paths.settingsFile, `${JSON.stringify({ listen })}\n`, { mode: 0o600 });
		return child.pid;
	} finally {
		await stderr.close();
	}
}

async function readPidFile(paths: DaemonPaths): Promise<DaemonPidFile | undefined> {
	try {
		return parseDaemonPidFile(await readFile(paths.pidFile, "utf8"));
	} catch (error: unknown) {
		if (isNodeErrorCode(error, "ENOENT")) return undefined;
		throw error;
	}
}

function resolveCliMainPath(): string {
	const modulePath = fileURLToPath(import.meta.url);
	const extension = modulePath.endsWith(".ts") ? ".ts" : ".js";
	return resolve(dirname(modulePath), "..", "..", `cli-main${extension}`);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
