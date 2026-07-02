import { execFile } from "node:child_process";

export interface DaemonPidFile {
	readonly pid: number;
	readonly processStartTime: string;
}

export function parseDaemonPidFile(text: string): DaemonPidFile | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error: unknown) {
		if (error instanceof SyntaxError) return undefined;
		throw error;
	}
	if (!isRecord(parsed) || typeof parsed.pid !== "number" || typeof parsed.processStartTime !== "string") {
		return undefined;
	}
	if (!Number.isInteger(parsed.pid) || parsed.pid <= 0 || parsed.processStartTime.trim() === "") {
		return undefined;
	}
	return { pid: parsed.pid, processStartTime: parsed.processStartTime };
}

export async function processMatchesPidFile(
	pidFile: DaemonPidFile,
	readStartTime: (pid: number) => Promise<string | undefined> = readProcessStartTime,
): Promise<boolean> {
	const current = await readStartTime(pidFile.pid);
	return current === pidFile.processStartTime;
}

export async function stopValidatedPid(pidFile: DaemonPidFile, signal: NodeJS.Signals): Promise<void> {
	if (!(await processMatchesPidFile(pidFile))) return;
	try {
		process.kill(pidFile.pid, signal);
	} catch (error: unknown) {
		if (!isNodeErrorCode(error, "ESRCH")) throw error;
	}
	if (signal === "SIGTERM") await waitForGone(pidFile, 10_000);
	if (signal === "SIGKILL") await waitForGone(pidFile, 2_000);
}

export async function waitForGone(pidFile: DaemonPidFile, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!(await processMatchesPidFile(pidFile))) return true;
		await delay(100);
	}
	return false;
}

export async function readProcessStartTime(pid: number): Promise<string | undefined> {
	return new Promise((resolveStartTime, reject) => {
		execFile("ps", ["-o", "lstart=", "-p", String(pid)], (error, stdout) => {
			if (error) {
				resolveStartTime(undefined);
				return;
			}
			resolveStartTime(stdout.trim() || undefined);
		}).once("error", reject);
	});
}

export async function waitForStartTime(pid: number, timeoutMs: number): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const startTime = await readProcessStartTime(pid);
		if (startTime) return startTime;
		await delay(20);
	}
	throw new Error(`spawned daemon pid ${pid} had no process start time`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
