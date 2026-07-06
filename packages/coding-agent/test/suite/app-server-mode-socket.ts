import { expect } from "vitest";
import WebSocket, { type RawData } from "ws";

export function captureStderrPort(): { readonly wait: Promise<number>; restore(): void } {
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

export function initializeRequest(id: number): Record<string, unknown> {
	return {
		id,
		method: "initialize",
		params: { clientInfo: { name: "qa-mode", title: "QA", version: "1.0.0" } },
	};
}

export function openSocket(port: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

export function closeSocket(socket: WebSocket): Promise<void> {
	if (socket.readyState === WebSocket.CLOSED) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		socket.once("close", () => resolve());
		socket.once("error", reject);
		socket.close();
	});
}

export async function initializeSocket(socket: WebSocket, reader: BufferedSocketReader): Promise<void> {
	socket.send(JSON.stringify(initializeRequest(1)));
	await expect(reader.readUntilResponse(1)).resolves.toMatchObject({
		id: 1,
		result: { userAgent: expect.any(String) },
	});
	socket.send(JSON.stringify({ method: "initialized", params: {} }));
}

type SocketWaiter = {
	readonly resolve: (message: Record<string, unknown>) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
};

export class BufferedSocketReader {
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
		const skipped: Record<string, unknown>[] = [];
		for (let index = 0; index < 16; index++) {
			const message = await this.readFor(`response ${id}`);
			if (message.id === id) {
				this.messages.unshift(...skipped);
				return message;
			}
			skipped.push(message);
		}
		this.messages.unshift(...skipped);
		throw new Error(`response ${id} not observed`);
	}

	async readUntilNotification(method: string): Promise<Record<string, unknown>> {
		const skipped: Record<string, unknown>[] = [];
		for (let index = 0; index < 16; index++) {
			const message = await this.readFor(`notification ${method}`);
			if (message.method === method) {
				this.messages.unshift(...skipped);
				return message;
			}
			skipped.push(message);
		}
		this.messages.unshift(...skipped);
		throw new Error(`notification ${method} not observed`);
	}

	private async readFor(label: string): Promise<Record<string, unknown>> {
		try {
			return await this.read();
		} catch (error: unknown) {
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(`${label} not observed: ${detail}`);
		}
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

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected object");
	}
}
