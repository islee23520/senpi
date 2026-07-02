import assert from "node:assert/strict";
import { request } from "node:http";
import { ServerCore } from "../../../src/modes/app-server/server/server-core.ts";
import { startAppServerWebSocketListener } from "../../../src/modes/app-server/transports/websocket.ts";

const port = parsePort(process.argv.slice(2));
const handle = await startAppServerWebSocketListener({
	host: "127.0.0.1",
	port,
	auth: { kind: "token-value", token: "task14-gate-review-token" },
	core: new ServerCore({ codexHome: "/tmp/senpi-task14-ws-noauth", version: "2026.7.2" }),
});

try {
	assert.equal(handle.port, port);
	assert.equal(await httpStatus(port, "/readyz"), 200);
	assert.equal(await httpStatus(port, "/healthz"), 200);
	assert.equal(await httpStatus(port, "/healthz", { Origin: "https://example.test" }), 403);
	assert.equal(await upgradeStatus(port, { Origin: "https://example.test" }), 403);
	assert.equal(await upgradeStatus(port), 401);

	console.log(JSON.stringify({ ok: true, port, checks: ["readyz", "healthz", "origin403", "missingBearer401"] }));
} finally {
	await handle.close();
}

function parsePort(args: readonly string[]): number {
	const portIndex = args.indexOf("--port");
	const portValue = portIndex === -1 ? undefined : args[portIndex + 1];
	if (portValue === undefined) {
		throw new Error("Usage: task14-ws-noauth.ts --port <port>");
	}
	const parsedPort = Number(portValue);
	if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
		throw new Error(`Invalid port: ${portValue}`);
	}
	return parsedPort;
}

async function httpStatus(port: number, path: string, headers: Record<string, string> = {}): Promise<number> {
	const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
	await response.arrayBuffer();
	return response.status;
}

function upgradeStatus(port: number, headers: Record<string, string> = {}): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({
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
			resolve(101);
			req.destroy();
		});
		req.once("response", (response) => {
			resolve(response.statusCode ?? 0);
			response.resume();
		});
		req.once("error", reject);
		req.end();
	});
}
