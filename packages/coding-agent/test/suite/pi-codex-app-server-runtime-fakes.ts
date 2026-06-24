import type { PiCodexAppServerWebSocketLike } from "../../src/core/extensions/builtin/pi-codex-app-server/transport-runtime.ts";

export class FakeWebSocket implements PiCodexAppServerWebSocketLike {
	readonly url: string;
	readyState = 0;
	private readonly listeners = new Map<string, Set<() => void>>();

	constructor(url: string, options: { readonly open: boolean; readonly closeAfterOpen?: boolean } = { open: true }) {
		this.url = url;
		if (options.open) {
			queueMicrotask(() => {
				this.readyState = 1;
				this.emit("open");
				if (options.closeAfterOpen) {
					this.closeUnexpectedly();
				}
			});
		}
	}

	addEventListener(
		type: "open" | "error" | "close",
		listener: () => void,
		options?: { readonly once?: boolean },
	): void {
		const wrapped = options?.once
			? () => {
					this.removeEventListener(type, wrapped);
					listener();
				}
			: listener;
		const listeners = this.listeners.get(type) ?? new Set<() => void>();
		listeners.add(wrapped);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: "open" | "error" | "close", listener: () => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	close(): void {
		this.readyState = 3;
		this.emit("close");
	}

	closeUnexpectedly(): void {
		this.readyState = 3;
		this.emit("close");
	}

	private emit(type: "open" | "error" | "close"): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener();
		}
	}
}
