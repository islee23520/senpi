import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import WebSocket from "ws";
import { ServerCore } from "../../../src/modes/app-server/server/server-core.ts";
import { startAppServerUnixSocketListener } from "../../../src/modes/app-server/transports/unix-socket.ts";

const { sock } = parseArgs(process.argv.slice(2));
await rm(sock, { force: true });

const handle = await startAppServerUnixSocketListener({
	socketPath: sock,
	core: new ServerCore({ codexHome: "/tmp/senpi-task15-uds-live", version: "2026.7.2" }),
});

try {
	assert.equal(handle.socketPath, sock);
	const socket = await openSocket(sock);
	socket.send(
		JSON.stringify({
			id: 1,
			method: "initialize",
			params: { clientInfo: { name: "qa-uds-live", title: "QA", version: "0.0.1" } },
		}),
	);
	const response = await readSocketJson(socket);
	assert.equal(response.id, 1);
	assert.ok("result" in response);
	assert.equal("jsonrpc" in response, false);
	assert.ok(isRecord(response.result));
	const keys = Object.keys(response.result).sort();
	assert.deepEqual(keys, ["codexHome", "platformFamily", "platformOs", "userAgent"]);
	socket.close();
	console.log(`KEYS=${keys.join(",")}`);
	console.log(`SOCKET=${sock}`);
	console.log("OK=1");
} finally {
	await handle.close();
}

function parseArgs(args: readonly string[]): { readonly sock: string } {
	const sockIndex = args.indexOf("--sock");
	const sock = sockIndex === -1 ? undefined : args[sockIndex + 1];
	if (sock === undefined || !sock.startsWith("/tmp/senpi-qa-")) {
		throw new Error("Usage: task15-uds-live.ts --sock /tmp/senpi-qa-*.sock");
	}
	return { sock };
}

function openSocket(socketPath: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws+unix://${socketPath}:/`);
		socket.once("open", () => resolve(socket));
		socket.once("error", reject);
	});
}

function readSocketJson(socket: WebSocket): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		socket.once("message", (data, isBinary) => {
			if (isBinary) {
				reject(new Error("expected text websocket frame"));
				return;
			}
			try {
				const parsed: unknown = JSON.parse(data.toString("utf8"));
				if (!isRecord(parsed)) {
					reject(new Error("expected object websocket payload"));
					return;
				}
				resolve(parsed);
			} catch (error: unknown) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.once("error", reject);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
