const trackedChildren = new Set();
const trackedClosers = new Set();
const detachChildren = process.platform !== "win32";

export function installCleanupHooks() {
	const cleanup = () => cleanupAll();
	process.once("exit", cleanup);
	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.once(signal, () => {
			cleanupAll();
			process.exit(130);
		});
	}
}

export function cleanupAll() {
	for (const child of trackedChildren) {
		if (child.exitCode === null && child.signalCode === null) {
			killChild(child, "SIGKILL");
		}
		child.stdin?.destroy();
		child.stdout?.destroy();
		child.stderr?.destroy();
		child.unref();
	}
	trackedChildren.clear();
	for (const close of trackedClosers) {
		close();
	}
	trackedClosers.clear();
}

export async function cleanupAllAndWait(timeoutMs = 10000) {
	const children = [...trackedChildren];
	for (const child of children) {
		if (child.exitCode === null && child.signalCode === null) {
			killChild(child, "SIGTERM");
		}
	}
	let closed = await waitForChildrenClose(children, Math.min(3000, timeoutMs));
	if (!closed) {
		for (const child of children) {
			if (child.exitCode === null && child.signalCode === null) {
				killChild(child, "SIGKILL");
			}
		}
		closed = await waitForChildrenClose(children, timeoutMs);
	}
	if (!closed) {
		throw new Error(`Timed out waiting for child processes to close: ${liveChildPids(children).join(", ")}`);
	}
	for (const child of children) {
		child.stdin?.destroy();
		child.stdout?.destroy();
		child.stderr?.destroy();
		child.unref();
		trackedChildren.delete(child);
	}
	for (const close of trackedClosers) {
		close();
	}
	trackedClosers.clear();
}

export function trackChild(child) {
	trackedChildren.add(child);
	child.once("close", () => trackedChildren.delete(child));
}

export function trackCloser(close) {
	trackedClosers.add(close);
}

export function untrackCloser(close) {
	trackedClosers.delete(close);
}

export function shouldDetachChildren() {
	return detachChildren;
}

async function waitForChildrenClose(children, timeoutMs) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (liveChildPids(children).length === 0) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return liveChildPids(children).length === 0;
}

function liveChildPids(children) {
	return children
		.filter((child) => child.exitCode === null && child.signalCode === null)
		.map((child) => String(child.pid ?? "unknown"));
}

function killChild(child, signal) {
	if (child.pid === undefined) return;
	if (detachChildren) {
		try {
			process.kill(-child.pid, signal);
			return;
		} catch (error) {
			if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") {
				throw error;
			}
		}
	}
	child.kill(signal);
}
