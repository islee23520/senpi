import { access, chmod, mkdir, unlink } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createConnection } from "node:net";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../../config.ts";
import { ServerCore } from "../server/server-core.ts";
import { resolveWebSocketListenerAuth, type WebSocketListenerAuth } from "./websocket-auth.ts";
import { closeServer, createAppServerWebSocketConnectionHandler } from "./websocket-connection-handler.ts";

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
	const defaultSocketPath = join(getAgentDir(), "app-server", "app-server.sock");
	const socketPath = options.socketPath ?? defaultSocketPath;
	validateSocketPath(socketPath);
	await prepareSocketPath(
		socketPath,
		socketPath === defaultSocketPath && (options.auth === undefined || options.auth.kind === "off"),
	);

	const auth = await resolveWebSocketListenerAuth({
		auth: options.auth,
		stderr: options.stderr ?? process.stderr,
		tokenLogLabel: "app-server unix socket websocket token",
	});
	const core = options.core ?? new ServerCore();
	const handler = createAppServerWebSocketConnectionHandler({
		core,
		auth,
		transportKind: "unix",
		connectionIdPrefix: "unix",
		outboundQueueBytes: options.outboundQueueBytes,
	});
	const server = createServer();

	server.on("upgrade", handler.handleUpgrade);

	await listen(server, socketPath);

	return {
		socketPath,
		core,
		tokenFile: auth.kind === "bearer" ? auth.path : undefined,
		get connectionCount() {
			return handler.connectionCount;
		},
		async close() {
			handler.terminateConnections();
			await closeServer(server);
			await handler.close();
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

async function prepareSocketPath(socketPath: string, enforceOwnerOnlyDirectory: boolean): Promise<void> {
	const socketDirectory = dirname(socketPath);
	await mkdir(socketDirectory, { recursive: true, mode: 0o700 });
	if (enforceOwnerOnlyDirectory) {
		await chmod(socketDirectory, 0o700);
	}
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

function listen(server: Server, socketPath: string): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
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
