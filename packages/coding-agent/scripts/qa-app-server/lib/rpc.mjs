import { request as httpRequest } from "node:http";
import WebSocket from "ws";

export class ProbeError extends Error {
	constructor(message) {
		super(message);
		this.name = "ProbeError";
	}
}

export class StdioRpcClient {
	constructor(child, transcript, label) {
		this.child = child;
		this.transcript = transcript;
		this.label = label;
		this.messages = [];
		this.buffer = "";
		child.stdout.on("data", (chunk) => this.readStdout(chunk.toString("utf8")));
		child.stderr.on("data", (chunk) => this.transcript.push(`[${this.label} stderr] ${chunk.toString("utf8").trimEnd()}`));
	}

	mark() {
		return this.messages.length;
	}

	notify(method, params = {}) {
		this.write({ method, params });
	}

	async request(method, params = {}, timeoutMs = 20000) {
		const id = `${this.label}-${this.messages.length + 1}`;
		this.write({ id, method, params });
		const response = await this.waitForMessage((message) => message.id === id && !("method" in message), this.mark(), timeoutMs);
		if ("error" in response) {
			throw new ProbeError(`${method} failed: ${JSON.stringify(response.error)}`);
		}
		return response.result;
	}

	waitForMessage(predicate, fromIndex = 0, timeoutMs = 20000) {
		return waitFor(() => this.messages.slice(fromIndex).find(predicate), timeoutMs, `${this.label} message`);
	}

	close() {
		this.child.stdin.end();
	}

	readStdout(text) {
		this.buffer += text;
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline === -1) return;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (line.length === 0) continue;
			this.record(JSON.parse(line));
		}
	}

	write(message) {
		this.transcript.push(`[${this.label} >>] ${JSON.stringify(message)}`);
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	record(message) {
		this.messages.push(message);
		this.transcript.push(`[${this.label} <<] ${JSON.stringify(message)}`);
	}
}

export class WebSocketRpcClient {
	constructor(socket, transcript, label) {
		this.socket = socket;
		this.transcript = transcript;
		this.label = label;
		this.messages = [];
		socket.on("message", (data, isBinary) => {
			if (isBinary) {
				this.record({ error: "binary websocket frame" });
				return;
			}
			this.record(JSON.parse(data.toString("utf8")));
		});
	}

	static async connect(port, token, transcript, label) {
		const socket = await new Promise((resolveOpen, rejectOpen) => {
			const ws = new WebSocket(`ws://127.0.0.1:${port}/`, {
				headers: { Authorization: `Bearer ${token}` },
			});
			ws.once("open", () => resolveOpen(ws));
			ws.once("error", rejectOpen);
		});
		return new WebSocketRpcClient(socket, transcript, label);
	}

	mark() {
		return this.messages.length;
	}

	notify(method, params = {}) {
		this.write({ method, params });
	}

	async request(method, params = {}, timeoutMs = 20000) {
		const id = `${this.label}-${this.messages.length + 1}`;
		this.write({ id, method, params });
		const response = await this.waitForMessage((message) => message.id === id && !("method" in message), this.mark(), timeoutMs);
		if ("error" in response) {
			throw new ProbeError(`${method} failed: ${JSON.stringify(response.error)}`);
		}
		return response.result;
	}

	waitForMessage(predicate, fromIndex = 0, timeoutMs = 20000) {
		return waitFor(() => this.messages.slice(fromIndex).find(predicate), timeoutMs, `${this.label} message`);
	}

	close() {
		this.socket.terminate();
	}

	write(message) {
		this.transcript.push(`[${this.label} >>] ${JSON.stringify(message)}`);
		this.socket.send(JSON.stringify(message));
	}

	record(message) {
		this.messages.push(message);
		this.transcript.push(`[${this.label} <<] ${JSON.stringify(message)}`);
	}
}

export async function initialize(client, name) {
	const response = await client.request("initialize", {
		clientInfo: { name, title: name, version: "0.0.0" },
		capabilities: { experimentalApi: true },
	});
	client.notify("initialized");
	return response;
}

export async function assertTurnStream(client, threadId, fromIndex, timeoutMs = 90000) {
	await client.waitForMessage(
		(message) => message.method === "turn/started" && message.params?.threadId === threadId,
		fromIndex,
		timeoutMs,
	);
	await client.waitForMessage(
		(message) => message.method?.startsWith("item/") && message.params?.threadId === threadId,
		fromIndex,
		timeoutMs,
	);
	const completed = await client.waitForMessage(
		(message) => message.method === "turn/completed" && message.params?.threadId === threadId,
		fromIndex,
		timeoutMs,
	);
	if (completed.params?.turn?.status !== "completed") {
		throw new ProbeError(`turn terminal status was ${completed.params?.turn?.status ?? "missing"}`);
	}
	return completed;
}

export async function httpStatus(port, path, headers = {}) {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
	await response.arrayBuffer();
	return response.status;
}

export function upgradeStatus(port, headers = {}) {
	return new Promise((resolveStatus, rejectStatus) => {
		const req = httpRequest({
			host: "127.0.0.1",
			port,
			path: "/",
			headers: {
				Connection: "Upgrade",
				"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version": "13",
				Upgrade: "websocket",
				...headers,
			},
		});
		req.once("upgrade", () => {
			resolveStatus(101);
			req.destroy();
		});
		req.once("response", (response) => {
			resolveStatus(response.statusCode ?? 0);
			response.resume();
		});
		req.once("error", rejectStatus);
		req.end();
	});
}

export function waitFor(read, timeoutMs, label) {
	return new Promise((resolveWait, rejectWait) => {
		const deadline = Date.now() + timeoutMs;
		const timer = setInterval(() => {
			const value = read();
			if (value !== undefined) {
				clearInterval(timer);
				resolveWait(value);
				return;
			}
			if (Date.now() >= deadline) {
				clearInterval(timer);
				rejectWait(new ProbeError(`Timed out waiting for ${label}`));
			}
		}, 25);
	});
}

export function requiredThreadId(result) {
	const threadId = result?.thread?.id;
	if (typeof threadId !== "string" || threadId.length === 0) {
		throw new ProbeError(`missing thread id in ${JSON.stringify(result)}`);
	}
	return threadId;
}

export function pass(transcript, name) {
	transcript.push(`PASS ${name}`);
	process.stdout.write(`PASS ${name}\n`);
}

export function fail(transcript, name, error) {
	transcript.push(`FAIL ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
	process.stderr.write(`FAIL ${name}\n`);
	process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
}
