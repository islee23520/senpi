import type { AppServerRequestClient } from "../../src/core/extensions/builtin/pi-codex-app-server/request-router.ts";

export class RecordingAppServerClient implements AppServerRequestClient {
	readonly calls: { readonly method: string; readonly params: unknown }[] = [];
	private readonly responses: unknown[];

	constructor(responses: readonly unknown[]) {
		this.responses = [...responses];
	}

	async request(method: string, params: unknown): Promise<unknown> {
		this.calls.push({ method, params });
		return this.responses.shift() ?? {};
	}
}

export class ThrowOnceAppServerClient implements AppServerRequestClient {
	readonly calls: { readonly method: string; readonly params: unknown }[] = [];
	private thrown = false;

	async request(method: string, params: unknown): Promise<unknown> {
		this.calls.push({ method, params });
		if (!this.thrown) {
			this.thrown = true;
			throw new Error("synthetic app-server failure");
		}
		return { ok: true };
	}
}
