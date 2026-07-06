import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { probeListen } from "../../src/modes/app-server/daemon/probe.ts";
import { ServerCore } from "../../src/modes/app-server/server/server-core.ts";
import {
	startAppServerUnixSocketListener,
	type UnixSocketListenerHandle,
} from "../../src/modes/app-server/transports/unix-socket.ts";

const roots: string[] = [];
const handles: UnixSocketListenerHandle[] = [];

afterEach(async () => {
	await Promise.all(handles.splice(0).map((handle) => handle.close()));
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

describe("app-server daemon readiness probe", () => {
	it("initializes websocket-over-unix listeners", async () => {
		// Given: a token-protected app-server websocket listener bound to a unix socket.
		const root = await scratchRoot("senpi-daemon-probe-");
		const socketPath = join(root, "app-server.sock");
		const tokenFile = join(root, "ws-token");
		await writeFile(tokenFile, "uds-probe-token\n", { mode: 0o600 });
		const handle = await startAppServerUnixSocketListener({
			socketPath,
			auth: { kind: "token-file", path: tokenFile },
			core: new ServerCore({ codexHome: root, version: "2026.7.3-test" }),
		});
		handles.push(handle);

		// When: daemon readiness probing targets the unix:// listen endpoint.
		const probed = await probeListen(
			{ tokenFile },
			{ kind: "unix", url: `unix://${socketPath}`, path: socketPath },
			2_000,
		);

		// Then: the probe completes the initialize handshake over the unix socket.
		expect(probed).toBeDefined();
		expect(probed).toContain("senpi_app_server_daemon/2026.7.3-test");
		expect(handle.connectionCount).toBe(1);
	});
});

async function scratchRoot(prefix: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), prefix));
	roots.push(root);
	return root;
}
