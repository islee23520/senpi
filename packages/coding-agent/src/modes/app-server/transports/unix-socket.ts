import { timingSafeEqual } from "node:crypto";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import type { Duplex } from "node:stream";
import WebSocket, { WebSocketServer } from "ws";
import { getAgentDir } from "../../../config.ts";
import type { RpcEnvelope } from "../rpc/envelope.ts";
import { parseNdjsonLine, serializeNdjsonMessage } from "../rpc/ndjson.ts";
import { ServerCore } from "../server/server-core.ts";
import type { WebSocketListenerAuth } from "./websocket.ts";

export interface UnixSocketListenerOptions {
	readonly socketPath?: string;
	readonly auth?: WebSocketListenerAuth;
	readonly core?: ServerCore;
	readonly stderr?: Pick<NodeJS.WriteStream, "write">;
	readonly outboundQueueBytes?: number;
}

export interface UnixSocketListenerHandle {
	readonly socketPath: string;
	readonly core: ServerCore;
	readonly tokenFile: string | undefined;
	readonly connectionCount: number;
	close(): Promise<void>;
}

type ResolvedAuth =
	| { readonly kind: "off" }
	| { readonly kind: "bearer"; readonly token: string; readonly path?: string };

const DEFAULT_OUTBOUND_QUEUE_BYTES = 16 * 1024 * 1024;
const WEBSOCKET_RETRY_LATER = 1013;
const SOCKET_PATH_BYTE_LIMIT = 100;

export class AppServerUnixSocketListenError extends Error {
	readonly exitCode = 2;

	constructor(message: string) {
		super(message);
		this.name = "AppServerUnixSocketListenError";
	}
}

export async function startAppServerUnixSocketListener(
	options: UnixSocketListenerOptions = {},
): Promise<UnixSocketListenerHandle> {
	const socketPath = options.socketPath ?? join(getAgentDir(), "app-server", "app-server.sock");
	validateSocketPath(socketPath);
	await prepareSocketPath(socketPath);

	const auth = await resolveAuth(options.auth, options.stderr ?? process.stderr);
	const core = options.core ?? new ServerCore();
	const wss = new WebSocketServer({ noServer: true });
	const connections = new Set<WebSocket>();
	let nextConnectionId = 1;
	const server = createServer();

	server.on("upgrade", (request, socket, head) => {
		if (hasOrigin(request)) {
			rejectUpgrade(socket, 403, "Forbidden");
			return;
		}
		if (request.url !== "/") {
			rejectUpgrade(socket, 400, "Bad Request");
			return;
		}
		if (!authorized(request, auth)) {
			rejectUpgrade(socket, 401, "Unauthorized");
			return;
		}
		wss.handleUpgrade(request, socket, head, (websocket) => {
			const connectionId = `unix-${nextConnectionId}`;
			nextConnectionId += 1;
			connections.add(websocket);
			core.addConnection({
				id: connectionId,
				transportKind: "unix",
				send: (message) => sendWebSocketMessage(websocket, message, options.outboundQueueBytes),
				close: () => {
					websocket.close(WEBSOCKET_RETRY_LATER, "slow-client");
				},
			});
			websocket.on("message", (data, isBinary) => {
				if (isBinary) return;
				const parsed = parseNdjsonLine(data.toString("utf8"));
				if (parsed.kind === "parse-error") {
					void sendWebSocketMessage(websocket, parsed.message, options.outboundQueueBytes);
					return;
				}
				void core.receive(connectionId, parsed);
			});
			websocket.on("close", () => {
				connections.delete(websocket);
				core.removeConnection(connectionId);
			});
		});
	});

	await listen(server, socketPath);

	return {
		socketPath,
		core,
		tokenFile: auth.kind === "bearer" ? auth.path : undefined,
		get connectionCount() {
			return connections.size;
		},
		async close() {
			for (const websocket of connections) {
				websocket.terminate();
			}
			await closeServer(server);
			await closeServer(wss);
			await removeSocketPath(socketPath);
		},
	};
}

function validateSocketPath(socketPath: string): void {
	if (Buffer.byteLength(socketPath) <= SOCKET_PATH_BYTE_LIMIT) {
		return;
	}
	throw new AppServerUnixSocketListenError(
		`Unix socket path is too long for portable app-server startup: ${socketPath}. pass a shorter unix:///path.`,
	);
}

async function prepareSocketPath(socketPath: string): Promise<void> {
	await mkdir(dirname(socketPath), { recursive: true });
	try {
		await access(socketPath);
	} catch (error: unknown) {
		if (isNodeErrorCode(error, "ENOENT")) {
			return;
		}
		throw error;
	}

	if (await probeLiveSocket(socketPath)) {
		throw new AppServerUnixSocketListenError(`${socketPath}: address already in use by a live server.`);
	}
	await unlink(socketPath);
}

function probeLiveSocket(socketPath: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection(socketPath);
		let settled = false;
		const settle = (result: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			socket.destroy();
			resolve(result);
		};
		socket.once("connect", () => settle(true));
		socket.once("error", () => settle(false));
		socket.setTimeout(1_000, () => settle(false));
	});
}

async function resolveAuth(
	auth: WebSocketListenerAuth | undefined,
	stderr: Pick<NodeJS.WriteStream, "write">,
): Promise<ResolvedAuth> {
	if (auth === undefined || auth.kind === "off") {
		return { kind: "off" };
	}
	if (auth.kind === "token-value") {
		return { kind: "bearer", token: auth.token };
	}
	const token = await readTokenFile(auth.path);
	stderr.write(`app-server unix socket websocket token: ${auth.path}\n`);
	return { kind: "bearer", token, path: auth.path };
}

async function readTokenFile(path: string): Promise<string> {
	return (await readFile(path, "utf8")).trim();
}

function authorized(request: IncomingMessage, auth: ResolvedAuth): boolean {
	if (auth.kind === "off") {
		return true;
	}
	const header = request.headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) {
		return false;
	}
	return tokensEqual(header.slice("Bearer ".length), auth.token);
}

function tokensEqual(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendWebSocketMessage(
	websocket: WebSocket,
	message: RpcEnvelope,
	outboundQueueBytes = DEFAULT_OUTBOUND_QUEUE_BYTES,
): Promise<void> {
	const payload = serializeNdjsonMessage(message).trimEnd();
	if (websocket.bufferedAmount + Buffer.byteLength(payload) > outboundQueueBytes) {
		const closed = waitForSocketClose(websocket);
		websocket.close(WEBSOCKET_RETRY_LATER, "slow-client");
		return closed;
	}
	return new Promise((resolve, reject) => {
		websocket.send(payload, (error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

function waitForSocketClose(websocket: WebSocket): Promise<void> {
	if (websocket.readyState === WebSocket.CLOSED) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		websocket.once("close", () => resolve());
	});
}

function hasOrigin(request: IncomingMessage): boolean {
	return request.headers.origin !== undefined;
}

function rejectUpgrade(socket: Duplex, statusCode: 400 | 401 | 403, reason: string): void {
	socket.write(`HTTP/1.1 ${statusCode} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
	socket.destroy();
}

function listen(server: Server, socketPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function closeServer(server: Pick<Server | WebSocketServer, "close">): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
				return;
			}
			resolve();
		});
	});
}

async function removeSocketPath(socketPath: string): Promise<void> {
	try {
		await unlink(socketPath);
	} catch (error: unknown) {
		if (isNodeErrorCode(error, "ENOENT")) {
			return;
		}
		throw error;
	}
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
