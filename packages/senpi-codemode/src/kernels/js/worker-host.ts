import { Worker } from "node:worker_threads";
import type { KernelToHostMessage } from "../../bridge/protocol.ts";
import type { WorkerLike } from "./inline-worker.ts";

export class WorkerStartupCancelledError extends Error {
	readonly name = "WorkerStartupCancelledError";

	constructor() {
		super("JavaScript worker startup was cancelled");
	}
}

export function spawnNodeWorker(url: URL, cwd: string, parallelPoolWidth: number): WorkerLike {
	return wrapNodeWorker(
		new Worker(url, {
			workerData: { cwd, parallelPoolWidth },
		}),
	);
}

export function waitForReady(worker: WorkerLike, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		let offMessage = (): void => {};
		let offError = (): void => {};
		const cleanup = (): void => {
			offMessage();
			offError();
			signal.removeEventListener("abort", onAbort);
		};
		const onAbort = (): void => {
			cleanup();
			reject(new WorkerStartupCancelledError());
		};
		offMessage = worker.onMessage((message) => {
			if (message.type === "ready") {
				cleanup();
				resolve();
			} else if (message.type === "init-failed") {
				cleanup();
				reject(errorFromBridge(message.error));
			}
		});
		offError = worker.onError((error) => {
			cleanup();
			reject(error);
		});
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function errorFromBridge(error: {
	readonly message: string;
	readonly name?: string;
	readonly stack?: string;
}): Error {
	const result = new Error(error.message);
	if (error.name) result.name = error.name;
	if (error.stack) result.stack = error.stack;
	return result;
}

export function bridgeError(error: Error): {
	readonly message: string;
	readonly name?: string;
	readonly stack?: string;
} {
	return { message: error.message, name: error.name, stack: error.stack };
}

function wrapNodeWorker(worker: Worker): WorkerLike {
	return {
		mode: "worker",
		postMessage: (message) => worker.postMessage(message),
		onMessage(handler) {
			const listener = (message: KernelToHostMessage): void => handler(message);
			worker.on("message", listener);
			return () => worker.off("message", listener);
		},
		onError(handler) {
			worker.on("error", handler);
			return () => worker.off("error", handler);
		},
		async terminate() {
			await worker.terminate();
		},
	};
}
