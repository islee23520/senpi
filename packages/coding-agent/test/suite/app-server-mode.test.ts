import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket, { type RawData } from "ws";
import { restoreStdout } from "../../src/core/output-guard.ts";
import { runAppServerMode } from "../../src/modes/app-server/index.ts";

const runningModes: Array<Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
	if (runningModes.length > 0) {
		process.emit("SIGTERM", "SIGTERM");
	}
	await Promise.allSettled(runningModes.splice(0));
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
	restoreStdout();
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe("app-server mode entry", () => {
	it("boots a websocket loopback mode and shuts down cleanly after thread lifecycle requests", async () => {
		// Given: isolated app-server state and a mode entry listening on a QA loopback port.
		const root = await scratchRoot();
		vi.stubEnv("SENPI_CODING_AGENT_DIR", join(root, "agent"));
		vi.stubEnv("SENPI_CODING_AGENT_SESSION_DIR", join(root, "sessions"));
		vi.stubEnv("PI_OFFLINE", "1");
		vi.spyOn(process, "exit").mockImplementation(exitThrows);
		const banner = captureStderrPort();
		const mode = runAppServerMode({
			kind: "server",
			listen: {
				kind: "ws",
				url: "ws://127.0.0.1:0",
				host: "127.0.0.1",
				port: 0,
			},
			wsAuth: { kind: "off" },
			jsonLogs: false,
		});
		runningModes.push(mode);

		// When: a real websocket client drives initialize, start, loaded/list, and unsubscribe.
		const port = await Promise.race([banner.wait, mode.then(() => failModeExited())]);
		const socket = await openSocket(port);
		const reader = new BufferedSocketReader(socket);
		try {
			socket.send(JSON.stringify(initializeRequest(1)));
			await expect(reader.read()).resolves.toMatchObject({ id: 1, result: { userAgent: expect.any(String) } });
			socket.send(JSON.stringify({ method: "initialized", params: {} }));
			socket.send(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: root } }));
			const started = await reader.readUntilResponse(2);
			const threadId = threadIdFromResponse(started);

			socket.send(JSON.stringify({ id: 3, method: "thread/loaded/list", params: {} }));
			expect(await reader.readUntilResponse(3)).toMatchObject({
				id: 3,
				result: { data: [threadId] },
			});
			socket.send(JSON.stringify({ id: 4, method: "thread/unsubscribe", params: { threadId } }));
			expect(await reader.readUntilResponse(4)).toEqual({ id: 4, result: { status: "unsubscribed" } });
		} finally {
			reader.dispose();
			socket.close();
		}
		process.emit("SIGTERM", "SIGTERM");
		await expect(mode).resolves.toBeUndefined();
		runningModes.splice(runningModes.indexOf(mode), 1);

		// Then: the listener releases its port and the process-level signal handler is gone.
		await expect(fetch(`http://127.0.0.1:${port}/readyz`)).rejects.toThrow();
		banner.restore();
	});
});

function exitThrows(code?: string | number | null): never {
	throw new Error(`process.exit ${String(code)}`);
}

function failModeExited(): never {
	throw new Error("app-server mode exited before startup");
}

async function scratchRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "senpi-app-server-mode-"));
	roots.push(root);
	return root;
}

function captureStderrPort(): { readonly wait: Promise<number>; restore(): void } {
	const original = process.stderr.write;
	let buffer = "";
	let resolved = false;
	let resolvePort: (port: number) => void = () => {};
	let rejectPort: (error: Error) => void = () => {};
	const wait = new Promise<number>((resolve, reject) => {
		resolvePort = resolve;
		rejectPort = reject;
	});
	const timeout = setTimeout(() => {
		if (!resolved) rejectPort(new Error(`startup banner not observed: ${buffer}`));
	}, 5_000);

	process.stderr.write = function writeStderr(
		chunk: string | Uint8Array,
		encodingOrCallback?: BufferEncoding | (() => void),
		callback?: () => void,
	): boolean {
		buffer += String(chunk);
		const match = /readyz http:\/\/127\.0\.0\.1:(\d+)\/readyz/.exec(buffer);
		if (!resolved && match) {
			resolved = true;
			clearTimeout(timeout);
			resolvePort(Number(match[1]));
		}
		const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
		done?.();
		return true;
	};

	return {
		wait,
		restore() {
			clearTimeout(timeout);
			process.stderr.write = original;
		},
	};
}

function initializeRequest(id: number): Record<string, unknown> {
	return {
		id,
		method: "initialize",
		params: { clientInfo: { name: "qa-mode", title: "QA", version: "1.0.0" } },
	};
}

function openSocket(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

type SocketWaiter = {
	readonly resolve: (message: Record<string, unknown>) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
};

class BufferedSocketReader {
	private readonly messages: Record<string, unknown>[] = [];
	private readonly waiters: SocketWaiter[] = [];
	private readonly socket: WebSocket;

	constructor(socket: WebSocket) {
		this.socket = socket;
		this.socket.on("message", this.onMessage);
		this.socket.on("error", this.onError);
		this.socket.on("close", this.onClose);
	}

	dispose(): void {
		this.socket.off("message", this.onMessage);
		this.socket.off("error", this.onError);
		this.socket.off("close", this.onClose);
		for (const waiter of this.waiters.splice(0)) {
			clearTimeout(waiter.timeout);
			waiter.reject(new Error("socket reader disposed"));
		}
	}

	read(timeoutMs = 5_000): Promise<Record<string, unknown>> {
		const message = this.messages.shift();
		if (message) {
			return Promise.resolve(message);
		}
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				const index = this.waiters.findIndex((waiter) => waiter.reject === reject);
				if (index !== -1) {
					this.waiters.splice(index, 1);
				}
				reject(new Error(`websocket frame not observed within ${timeoutMs}ms`));
			}, timeoutMs);
			this.waiters.push({ resolve, reject, timeout });
		});
	}

	async readUntilResponse(id: number): Promise<Record<string, unknown>> {
		for (let index = 0; index < 16; index++) {
			const message = await this.read();
			if (message.id === id) {
				return message;
			}
		}
		throw new Error(`response ${id} not observed`);
	}

	private readonly onMessage = (data: RawData, isBinary: boolean): void => {
		if (isBinary) {
			this.rejectNext(new Error("expected text websocket frame"));
			return;
		}
		const parsed: unknown = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
		expectRecord(parsed);
		this.push(parsed);
	};

	private readonly onError = (error: Error): void => {
		this.rejectNext(error);
	};

	private readonly onClose = (): void => {
		this.rejectNext(new Error("websocket closed"));
	};

	private push(message: Record<string, unknown>): void {
		const waiter = this.waiters.shift();
		if (!waiter) {
			this.messages.push(message);
			return;
		}
		clearTimeout(waiter.timeout);
		waiter.resolve(message);
	}

	private rejectNext(error: Error): void {
		const waiter = this.waiters.shift();
		if (!waiter) {
			return;
		}
		clearTimeout(waiter.timeout);
		waiter.reject(error);
	}
}

function threadIdFromResponse(response: Record<string, unknown>): string {
	expectRecord(response.result);
	expectRecord(response.result.thread);
	const threadId = response.result.thread.id;
	if (typeof threadId !== "string") {
		throw new Error("thread/start response missing thread id");
	}
	return threadId;
}

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected object");
	}
}
