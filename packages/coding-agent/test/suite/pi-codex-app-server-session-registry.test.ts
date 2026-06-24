import { describe, expect, it } from "vitest";
import { createSessionRegistry } from "../../src/core/extensions/builtin/pi-codex-app-server/session-registry.ts";

describe("pi-codex-app-server session registry", () => {
	it("rejects duplicate external session and app-thread bindings without overwriting existing state", () => {
		const registry = createSessionRegistry();
		const firstBinding = registry.bindSession({
			externalSessionId: "external-session-1",
			appThreadId: "app-thread-1",
			appSessionId: "app-session-1",
		});
		const duplicateExternal = registry.bindSession({
			externalSessionId: "external-session-1",
			appThreadId: "app-thread-2",
			appSessionId: "app-session-2",
		});
		const duplicateThread = registry.bindSession({
			externalSessionId: "external-session-2",
			appThreadId: "app-thread-1",
			appSessionId: "app-session-3",
		});

		expect(firstBinding).toMatchObject({
			kind: "bound",
			binding: {
				externalSessionId: "external-session-1",
				appThreadId: "app-thread-1",
				appSessionId: "app-session-1",
			},
		});
		expect(duplicateExternal).toMatchObject({
			kind: "rejected",
			error: {
				data: {
					source: "pi-codex-app-server",
					adapterCode: "duplicate-routing-id",
				},
			},
		});
		expect(duplicateThread).toMatchObject({
			kind: "rejected",
			error: {
				data: {
					source: "pi-codex-app-server",
					adapterCode: "duplicate-routing-id",
				},
			},
		});
		expect(registry.getByExternalSessionId("external-session-1")).toMatchObject({
			externalSessionId: "external-session-1",
			appThreadId: "app-thread-1",
			appSessionId: "app-session-1",
		});
		expect(registry.getByAppThreadId("app-thread-1")).toMatchObject({
			externalSessionId: "external-session-1",
			appThreadId: "app-thread-1",
			appSessionId: "app-session-1",
		});
		expect(registry.getByExternalSessionId("external-session-2")).toBeUndefined();
	});
});
