import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { isIP } from "node:net";
import { join } from "node:path";
import { getAgentDir } from "../../../config.ts";
import { ServerCore } from "../server/server-core.ts";
import { resolveWebSocketListenerAuth, type WebSocketListenerAuth } from "./websocket-auth.ts";
import { closeServer, createAppServerWebSocketConnectionHandler } from "./websocket-connection-handler.ts";

export type { WebSocketListenerAuth } from "./websocket-auth.ts";

export type WebSocketListenerOptions = {
	readonly host: string;
	readonly port: number;
	readonly auth?: WebSocketListenerAuth;
	readonly core?: ServerCore;
	readonly stderr?: Pick<NodeJS.WriteStream, "write">;
	readonly outboundQueueBytes?: number;
};

export type WebSocketListenerHandle = {
	readonly host: string;
	readonly port: number;
	readonly core: ServerCore;
	readonly tokenFile: string | undefined;
	readonly connectionCount: number;
	close(): Promise<void>;
};

export class AppServerWebSocketListenError extends Error {
	readonly exitCode = 2;

	constructor(message: string) {
		super(message);
		this.name = "AppServerWebSocketListenError";
	}
}

export async function startAppServerWebSocketListener(
	options: WebSocketListenerOptions,
): Promise<WebSocketListenerHandle> {
	const auth = await resolveWebSocketListenerAuth({
		auth: options.auth,
		stderr: options.stderr ?? process.stderr,
		defaultTokenPath: join(getAgentDir(), "app-server", "ws-token"),
		tokenLogLabel: "app-server websocket token",
	});
	if (auth.kind === "off" && !isLoopbackHost(options.host)) {
		throw new AppServerWebSocketListenError("Refusing unauthenticated app-server websocket on non-loopback host.");
	}

	const core = options.core ?? new ServerCore();
	const handler = createAppServerWebSocketConnectionHandler({
		core,
		auth,
		transportKind: "websocket",
		connectionIdPrefix: "ws",
		outboundQueueBytes: options.outboundQueueBytes,
	});
	let accepting = true;
	const server = createServer((request, response) => handleHttpRequest(request, response, accepting));

	server.on("upgrade", handler.handleUpgrade);

	await listen(server, options.host, options.port);
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new AppServerWebSocketListenError("Websocket listener did not bind to a TCP address.");
	}

	return {
		host: options.host,
		port: address.port,
		core,
		tokenFile: auth.kind === "bearer" ? auth.path : undefined,
		get connectionCount() {
			return handler.connectionCount;
		},
		async close() {
			accepting = false;
			handler.terminateConnections();
			await closeServer(server);
			await handler.close();
		},
	};
}

function handleHttpRequest(request: IncomingMessage, response: ServerResponse, accepting: boolean): void {
	if (hasOrigin(request)) {
		writeText(response, 403, "forbidden\n");
		return;
	}
	if ((request.url === "/readyz" || request.url === "/healthz") && accepting) {
		writeText(response, 200, "ok\n");
		return;
	}
	writeText(response, 400, "websocket upgrade required\n");
}

function hasOrigin(request: IncomingMessage): boolean {
	return request.headers.origin !== undefined;
}

function writeText(response: ServerResponse, statusCode: number, body: string): void {
	response.writeHead(statusCode, { "content-type": "text/plain; charset=utf-8" }).end(body);
}

function listen(server: Server, host: string, port: number): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, host, () => {
			server.off("error", reject);
			resolve();
		});
	});
}

function isLoopbackHost(host: string): boolean {
	return host === "::1" || (isIP(host) === 4 && host.startsWith("127."));
}
