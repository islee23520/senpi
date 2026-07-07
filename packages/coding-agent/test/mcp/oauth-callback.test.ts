import { mkdtemp, rm } from "node:fs/promises";
import { connect, createServer as createNetServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type CallbackChannel,
	LoopbackCallbackServer,
	openCallbackChannel,
} from "../../src/core/extensions/builtin/mcp/auth/callback.ts";
import { type AuthCommandDeps, runAuth } from "../../src/core/extensions/builtin/mcp/auth/commands-auth.ts";
import type { McpOAuthProvider } from "../../src/core/extensions/builtin/mcp/auth/oauth-provider.ts";
import { McpTokenStore } from "../../src/core/extensions/builtin/mcp/auth/token-store.ts";
import type { McpServerConfig } from "../../src/core/extensions/builtin/mcp/config-schema.ts";
import { type IdpFixture, spawnOAuthIdp } from "./fixtures/spawn-idp.ts";

const openServers: LoopbackCallbackServer[] = [];
const openChannels: CallbackChannel[] = [];
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	await Promise.all(openServers.splice(0).map((server) => server.close()));
	await Promise.all(openChannels.splice(0).map((channel) => channel.close()));
	await Promise.all(cleanups.splice(0).map((fn) => fn()));
});

function portOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
	return new Promise((resolve) => {
		const socket: Socket = connect({ host, port }, () => {
			socket.destroy();
			resolve(true);
		});
		socket.on("error", () => resolve(false));
	});
}

async function freePort(): Promise<number> {
	const server = createNetServer();
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	await new Promise<void>((resolve) => server.close(() => resolve()));
	return port;
}

async function idp(args: string[] = []): Promise<IdpFixture> {
	const fixture = await spawnOAuthIdp(args);
	cleanups.push(fixture.cleanup);
	return fixture;
}

async function agentDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "mcp-callback-"));
	cleanups.push(() => rm(dir, { force: true, recursive: true }));
	return dir;
}

interface Harness {
	deps: AuthCommandDeps;
	browsered: URL[];
	store: McpTokenStore;
}

function makeHarness(dir: string, mcpUrl: string): Harness {
	const browsered: URL[] = [];
	const config: McpServerConfig = {
		type: "http",
		url: mcpUrl,
		args: [],
		enabled: true,
		lifecycle: "lazy",
		connectTimeoutMs: 4000,
		requestTimeoutMs: 4000,
		idleTimeoutMin: 10,
		exposure: "auto",
		logLevel: "info",
	};
	const deps: AuthCommandDeps = {
		serverName: "fix",
		config,
		agentDir: dir,
		hasUI: true,
		notify: () => undefined,
		openBrowser: (url) => {
			browsered.push(url);
		},
		onReconnect: () => Promise.resolve(),
		pending: new Map<string, McpOAuthProvider>(),
	};
	return { deps, browsered, store: new McpTokenStore({ agentDir: dir, serverName: "fix", serverUrl: mcpUrl }) };
}

async function followAuthorize(url: URL): Promise<Response> {
	const response = await fetch(url, { redirect: "manual" });
	const location = response.headers.get("location");
	if (location === null) throw new Error(`authorize did not redirect: ${response.status}`);
	return fetch(location);
}

describe("LoopbackCallbackServer", () => {
	it("has no listener before the flow starts and binds only during it", async () => {
		const port = await freePort();
		expect(await portOpen(port)).toBe(false);
		const server = new LoopbackCallbackServer({ serverName: "s", port, validateState: () => true });
		openServers.push(server);
		const redirectUrl = await server.start();
		expect(redirectUrl).toBe(`http://127.0.0.1:${port}/callback`);
		expect(await portOpen(port)).toBe(true);
		await server.close();
		expect(await portOpen(port)).toBe(false);
	});

	it("completes when a valid code+state redirect arrives", async () => {
		const server = new LoopbackCallbackServer({ serverName: "s", validateState: (s) => s === "good" });
		openServers.push(server);
		const redirectUrl = await server.start();
		const waiter = server.waitForCode();
		await fetch(`${redirectUrl}?code=abc123&state=good`);
		const result = await waiter;
		expect(result).toEqual({ code: "abc123", state: "good" });
	});

	it("requires a state parameter even when the validator is permissive", async () => {
		const server = new LoopbackCallbackServer({ serverName: "s", validateState: () => true });
		openServers.push(server);
		const redirectUrl = await server.start();
		const waiter = server.waitForCode();
		const rejected = expect(waiter).rejects.toMatchObject({ oauthKind: "state_mismatch" });
		const response = await fetch(`${redirectUrl}?code=abc`);
		expect(response.status).toBe(400);
		await rejected;
	});

	it("rejects a wrong/replayed state with 400 and does NOT complete the flow", async () => {
		const port = await freePort();
		const server = new LoopbackCallbackServer({ serverName: "s", port, validateState: () => false });
		openServers.push(server);
		const redirectUrl = await server.start();
		const waiter = server.waitForCode();
		const rejected = expect(waiter).rejects.toMatchObject({ oauthKind: "state_mismatch" });
		const response = await fetch(`${redirectUrl}?code=abc&state=replayed`);
		expect(response.status).toBe(400);
		await rejected;
		expect(await portOpen(port)).toBe(false);
	});

	it("tears down the listener on timeout (handle returns to baseline)", async () => {
		const port = await freePort();
		const server = new LoopbackCallbackServer({ serverName: "s", port, timeoutMs: 60, validateState: () => true });
		openServers.push(server);
		await server.start();
		expect(await portOpen(port)).toBe(true);
		await expect(server.waitForCode()).rejects.toMatchObject({ oauthKind: "needs_auth" });
		expect(await portOpen(port)).toBe(false);
	});

	it("fails fast with a clear message when a fixed port is already in use", async () => {
		const port = await freePort();
		const first = new LoopbackCallbackServer({ serverName: "s", port, validateState: () => true });
		openServers.push(first);
		await first.start();
		const second = new LoopbackCallbackServer({ serverName: "s", port, validateState: () => true });
		await expect(second.start()).rejects.toThrow(/already in use/);
	});

	it("opens zero local listeners when a callback URL override is set", async () => {
		const port = await freePort();
		const channel = await openCallbackChannel({
			serverName: "s",
			overrideUrl: "https://proxy.example/callback",
			port,
			validateState: () => true,
		});
		openChannels.push(channel);
		expect(channel.usesLoopback).toBe(false);
		expect(channel.redirectUrl).toBe("https://proxy.example/callback");
		expect(await portOpen(port)).toBe(false);
		await expect(channel.waitForCode()).rejects.toMatchObject({ oauthKind: "headless" });
	});

	it("rejects a second concurrent auth for the same server without opening another browser flow", async () => {
		const fixture = await idp();
		const dir = await agentDir();
		const harness = makeHarness(dir, fixture.mcpUrl);

		const first = runAuth(harness.deps);
		await vi.waitFor(() => expect(harness.browsered).toHaveLength(1));

		await expect(runAuth(harness.deps)).rejects.toThrow(/already in progress/);
		expect(harness.browsered).toHaveLength(1);

		const authorizationUrl = harness.browsered[0];
		if (authorizationUrl === undefined) throw new Error("no authorization URL");
		const callback = await followAuthorize(authorizationUrl);
		expect(callback.status).toBe(200);
		await first;
		expect(harness.store.read()?.accessToken).toMatch(/^SENTINEL_AT_/);
	});
});
