import { access, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { ServerCore } from "../../src/modes/app-server/server/server-core.ts";
import {
	AppServerUnixSocketListenError,
	startAppServerUnixSocketListener,
	type UnixSocketListenerHandle,
} from "../../src/modes/app-server/transports/unix-socket.ts";

const token = "uds-token";
const handles: UnixSocketListenerHandle[] = [];
const roots: string[] = [];

describe("app-server unix socket websocket listener", () => {
	afterEach(async () => {
		await Promise.all(handles.splice(0).map((handle) => handle.close()));
		for (const root of roots.splice(0)) {
			await rm(root, { recursive: true, force: true });
		}
		vi.unstubAllEnvs();
	});

	it("round-trips initialize over websocket frames on a unix socket without bearer auth by default", async () => {
		// Given: a UDS listener with default filesystem-permission auth.
		const socketPath = await socketPathFor("senpi-app-server-uds-");
		const handle = await startListener({ socketPath });
		const socket = await openSocket(socketPath);

		// When: initialize is sent as a websocket text frame over the unix socket.
		socket.send(JSON.stringify(initializeRequest(1, "qa-uds")));
		const response = await readSocketJson(socket);

		// Then: the server responds through the shared app-server connection surface.
		expect(response).toEqual({ id: 1, result: expect.any(Object) });
		expectRecord(response.result);
		expect(Object.keys(response.result).sort()).toEqual(["codexHome", "platformFamily", "platformOs", "userAgent"]);
		expect(handle.connectionCount).toBe(1);
		expect(handle.core.getConnection("unix-1")?.transportKind).toBe("unix");
		socket.close();
	});

	it("creates the default no-bearer socket directory with owner-only permissions", async () => {
		// Given: a default UDS listener rooted in an isolated agent directory.
		const agentDir = await agentDirFor("senpi-app-server-uds-agent-");
		vi.stubEnv("SENPI_CODING_AGENT_DIR", agentDir);

		// When: the listener starts without explicit bearer auth.
		const handle = await startAppServerUnixSocketListener({
			core: new ServerCore({ codexHome: "/tmp/senpi-uds-test-home", version: "2026.7.2" }),
		});
		handles.push(handle);
		const socketDirectory = join(agentDir, "app-server");

		// Then: filesystem auth is backed by a private socket directory.
		expect(handle.socketPath).toBe(join(socketDirectory, "app-server.sock"));
		expect((await stat(socketDirectory)).mode & 0o777).toBe(0o700);
	});

	it("unlinks stale socket files before binding and removes its socket file on close", async () => {
		// Given: a stale filesystem entry at the socket path.
		const socketPath = await socketPathFor("senpi-app-server-uds-stale-");
		await writeFile(socketPath, "stale", "utf8");

		// When: the listener starts and then shuts down.
		const handle = await startListener({ socketPath });
		await expect(access(socketPath)).resolves.toBeUndefined();
		await handle.close();
		handles.splice(handles.indexOf(handle), 1);

		// Then: stale state was recovered, and graceful shutdown cleaned the socket.
		await expect(access(socketPath)).rejects.toThrow();
	});

	it("refuses to bind over a live unix socket server", async () => {
		// Given: one live UDS listener already owns the socket path.
		const socketPath = await socketPathFor("senpi-app-server-uds-live-");
		await startListener({ socketPath });

		// When: a second listener attempts to bind the same path.
		const second = startAppServerUnixSocketListener({
			socketPath,
			core: new ServerCore({ codexHome: "/tmp/senpi-uds-test-home-2", version: "2026.7.2" }),
		});

		// Then: the second bind is refused as a live server conflict.
		await expect(second).rejects.toThrow(AppServerUnixSocketListenError);
		await expect(second).rejects.toThrow("address already in use by a live server");
	});

	it("guards socket paths that exceed the portable unix socket byte limit", async () => {
		// Given: a unix socket path longer than the app-server portable limit.
		const socketPath = `/tmp/${"x".repeat(101)}.sock`;

		// When: the listener starts.
		const started = startAppServerUnixSocketListener({ socketPath });

		// Then: startup fails with a code-2 style usage error.
		await expect(started).rejects.toMatchObject({ exitCode: 2 });
		await expect(started).rejects.toThrow("pass a shorter unix:///path");
	});

	it("honors explicit websocket bearer auth when configured", async () => {
		// Given: a UDS listener configured with an explicit websocket token.
		const socketPath = await socketPathFor("senpi-app-server-uds-auth-");
		const handle = await startListener({ socketPath, auth: { kind: "token-value", token } });

		// When: clients connect without and with the bearer token.
		const rejected = await upgradeStatus(socketPath);
		const socket = await openSocket(socketPath, token);
		socket.send(JSON.stringify(initializeRequest(1, "qa-uds-auth")));
		const response = await readSocketJson(socket);

		// Then: the unauthenticated upgrade is rejected, and the authenticated client initializes.
		expect(rejected).toBe(401);
		expect(response).toEqual({ id: 1, result: expect.any(Object) });
		expect(handle.connectionCount).toBe(1);
		socket.close();
	});
});

async function startListener(options: {
	readonly socketPath: string;
	readonly auth?:
		| { readonly kind: "off" }
		| { readonly kind: "token-file"; readonly path: string }
		| { readonly kind: "token-value"; readonly token: string };
}): Promise<UnixSocketListenerHandle> {
	const handle = await startAppServerUnixSocketListener({
		socketPath: options.socketPath,
		auth: options.auth,
		core: new ServerCore({ codexHome: "/tmp/senpi-uds-test-home", version: "2026.7.2" }),
	});
	handles.push(handle);
	return handle;
}

async function socketPathFor(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return join(root, "app.sock");
}

async function agentDirFor(prefix: string): Promise<string> {
	const root = await mkdtemp(join("/tmp", prefix));
	roots.push(root);
	return root;
}

function initializeRequest(id: number, name: string): Record<string, unknown> {
	return {
		id,
		method: "initialize",
		params: { clientInfo: { name, title: "QA", version: "0.0.1" } },
	};
}

function openSocket(socketPath: string, bearerToken?: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(`ws+unix://${socketPath}:/`, {
			headers: bearerToken ? { Authorization: `Bearer ${bearerToken}` } : {},
		});
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
				const text = typeof data === "string" ? data : data.toString("utf8");
				const parsed: unknown = JSON.parse(text);
				expectRecord(parsed);
				resolve(parsed);
			} catch (error: unknown) {
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.once("error", reject);
	});
}

function upgradeStatus(socketPath: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({
			socketPath,
			path: "/",
			headers: {
				Connection: "Upgrade",
				"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
				"Sec-WebSocket-Version": "13",
				Upgrade: "websocket",
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

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	expect(Array.isArray(value)).toBe(false);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected record");
	}
}
