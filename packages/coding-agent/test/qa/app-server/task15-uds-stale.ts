import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { ServerCore } from "../../../src/modes/app-server/server/server-core.ts";
import {
	AppServerUnixSocketListenError,
	startAppServerUnixSocketListener,
} from "../../../src/modes/app-server/transports/unix-socket.ts";

const { sock } = parseArgs(process.argv.slice(2));

const first = await startAppServerUnixSocketListener({
	socketPath: sock,
	core: new ServerCore({ codexHome: "/tmp/senpi-task15-uds-stale", version: "2026.7.2" }),
});

try {
	assert.equal(first.socketPath, sock);
	console.log("BOUND=1");
	try {
		await startAppServerUnixSocketListener({
			socketPath: sock,
			core: new ServerCore({ codexHome: "/tmp/senpi-task15-uds-stale-second", version: "2026.7.2" }),
		});
		throw new Error("second bind unexpectedly succeeded");
	} catch (error: unknown) {
		if (!(error instanceof AppServerUnixSocketListenError)) {
			throw error;
		}
		assert.match(error.message, /address already in use by a live server/);
		console.log("SECOND_BIND=refused");
		console.log(`SECOND_BIND_MESSAGE=${error.message}`);
	}
} finally {
	await first.close();
	await rm(sock, { force: true });
}

function parseArgs(args: readonly string[]): { readonly sock: string } {
	const sockIndex = args.indexOf("--sock");
	const sock = sockIndex === -1 ? undefined : args[sockIndex + 1];
	if (sock === undefined || !sock.startsWith("/tmp/senpi-qa-")) {
		throw new Error("Usage: task15-uds-stale.ts --sock /tmp/senpi-qa-*.sock");
	}
	return { sock };
}
