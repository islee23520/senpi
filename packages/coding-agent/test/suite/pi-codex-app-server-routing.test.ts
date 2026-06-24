import { describe, expect, it } from "vitest";
import { createIdMapper } from "../../src/core/extensions/builtin/pi-codex-app-server/id-mapper.ts";
import { PI_CODEX_APP_SERVER_PROTOCOL_VERSION } from "../../src/core/extensions/builtin/pi-codex-app-server/protocol-core.ts";
import { createRequestRouter } from "../../src/core/extensions/builtin/pi-codex-app-server/request-router.ts";
import { createSessionRegistry } from "../../src/core/extensions/builtin/pi-codex-app-server/session-registry.ts";
import { RecordingAppServerClient, ThrowOnceAppServerClient } from "./pi-codex-app-server-routing-fakes.ts";

describe("pi-codex-app-server routing state", () => {
	it("routes initialize through capability negotiation with Codex capability field names", async () => {
		const client = new RecordingAppServerClient([{ server: "initialized" }]);
		const router = createRequestRouter({
			client,
			idMapper: createIdMapper(),
			sessionRegistry: createSessionRegistry(),
			appServerCapabilities: {
				experimentalApi: true,
				requestAttestation: true,
				mcpServerOpenaiFormElicitation: true,
				optOutNotificationMethods: ["warning", "thread/tokenUsage/updated"],
			},
		});

		const result = await router.route({
			method: "initialize",
			params: {
				protocolVersion: PI_CODEX_APP_SERVER_PROTOCOL_VERSION,
				capabilities: {
					semanticEvents: true,
					opaqueNotifications: true,
					opaqueCallbacks: true,
					notificationOptOuts: ["thread/tokenUsage/updated"],
				},
			},
			externalRequestId: "external-request-1",
		});

		expect(result).toMatchObject({ kind: "app-server-response", appServerResponse: { server: "initialized" } });
		expect(client.calls).toEqual([
			{
				method: "initialize",
				params: {
					capabilities: {
						experimentalApi: true,
						requestAttestation: true,
						mcpServerOpenaiFormElicitation: true,
						optOutNotificationMethods: ["thread/tokenUsage/updated"],
					},
				},
			},
		]);
	});

	it("binds external sessions to authoritative app-server thread and session IDs", async () => {
		const registry = createSessionRegistry();
		const client = new RecordingAppServerClient([
			{ thread: { id: "app-thread-1", session_id: "app-session-1" } },
			{ thread: { id: "app-thread-2", session_id: "app-session-2" } },
		]);
		const router = createRequestRouter({
			client,
			idMapper: createIdMapper(),
			sessionRegistry: registry,
		});

		await router.route({
			method: "session/new",
			externalRequestId: "external-request-2",
			params: { externalSessionId: "external-session-1", appParams: { cwd: "/tmp/project" } },
		});
		await router.route({
			method: "session/resume",
			externalRequestId: "external-request-3",
			params: { externalSessionId: "external-session-2", appParams: { thread_id: "app-thread-2" } },
		});

		expect(registry.getByExternalSessionId("external-session-1")).toMatchObject({
			externalSessionId: "external-session-1",
			appThreadId: "app-thread-1",
			appSessionId: "app-session-1",
			tombstoned: false,
		});
		expect(registry.getByAppThreadId("app-thread-2")).toMatchObject({
			externalSessionId: "external-session-2",
			appThreadId: "app-thread-2",
			appSessionId: "app-session-2",
		});
		expect(client.calls.map((call) => call.method)).toEqual(["thread/start", "thread/resume"]);
	});

	it("cleans request correlation when app-server routing throws before a result", async () => {
		const client = new ThrowOnceAppServerClient();
		const router = createRequestRouter({
			client,
			idMapper: createIdMapper(),
			sessionRegistry: createSessionRegistry(),
		});

		await expect(
			router.route({
				method: "session/list",
				externalRequestId: "external-request-retry",
				params: { appParams: { limit: 1 } },
			}),
		).rejects.toThrow("synthetic app-server failure");
		const retry = await router.route({
			method: "session/list",
			externalRequestId: "external-request-retry",
			params: { appParams: { limit: 1 } },
		});

		expect(retry).toEqual({ kind: "app-server-response", appServerResponse: { ok: true } });
		expect(client.calls).toEqual([
			{ method: "thread/list", params: { limit: 1 } },
			{ method: "thread/list", params: { limit: 1 } },
		]);
	});

	it("rejects duplicate external session bindings before calling app-server", async () => {
		const registry = createSessionRegistry();
		const client = new RecordingAppServerClient([
			{ thread: { id: "app-thread-1", session_id: "app-session-1" } },
			{ thread: { id: "orphan-thread", session_id: "orphan-session" } },
		]);
		const router = createRequestRouter({
			client,
			idMapper: createIdMapper(),
			sessionRegistry: registry,
		});

		await router.route({
			method: "session/new",
			externalRequestId: "external-request-first",
			params: { externalSessionId: "external-session-1", appParams: { cwd: "/tmp/project" } },
		});
		const duplicate = await router.route({
			method: "session/new",
			externalRequestId: "external-request-duplicate",
			params: { externalSessionId: "external-session-1", appParams: { cwd: "/tmp/other" } },
		});

		expect(duplicate).toMatchObject({
			kind: "adapter-error",
			error: {
				data: {
					source: "pi-codex-app-server",
					adapterCode: "duplicate-routing-id",
				},
			},
		});
		expect(client.calls).toEqual([{ method: "thread/start", params: { cwd: "/tmp/project" } }]);
		expect(registry.getByExternalSessionId("external-session-1")).toMatchObject({
			appThreadId: "app-thread-1",
			appSessionId: "app-session-1",
		});
	});

	it("routes turn start, steer, and interrupt using app-server IDs from session state", async () => {
		const registry = createSessionRegistry();
		const idMapper = createIdMapper();
		const client = new RecordingAppServerClient([
			{ thread: { id: "app-thread-1", session_id: "app-session-1" } },
			{ turn: { id: "app-turn-1" } },
			{ ok: true },
			{ ok: true },
		]);
		const router = createRequestRouter({ client, idMapper, sessionRegistry: registry });

		await router.route({
			method: "session/new",
			externalRequestId: "external-request-4",
			params: { externalSessionId: "external-session-1", appParams: { cwd: "/tmp/project" } },
		});
		await router.route({
			method: "turn/start",
			externalRequestId: "external-request-5",
			externalMessageId: "external-message-1",
			params: { externalSessionId: "external-session-1", appParams: { input: [{ text: "hello" }] } },
		});
		await router.route({
			method: "turn/steer",
			externalRequestId: "external-request-6",
			params: {
				externalSessionId: "external-session-1",
				appTurnId: "app-turn-1",
				appParams: { input: [{ text: "steer" }] },
			},
		});
		await router.route({
			method: "turn/interrupt",
			externalRequestId: "external-request-7",
			params: { externalSessionId: "external-session-1", appTurnId: "app-turn-1" },
		});

		expect(client.calls.slice(1)).toEqual([
			{
				method: "turn/start",
				params: {
					thread_id: "app-thread-1",
					client_user_message_id: "external-message-1",
					input: [{ text: "hello" }],
				},
			},
			{
				method: "turn/steer",
				params: {
					thread_id: "app-thread-1",
					expected_turn_id: "app-turn-1",
					input: [{ text: "steer" }],
				},
			},
			{
				method: "turn/interrupt",
				params: {
					thread_id: "app-thread-1",
					turn_id: "app-turn-1",
				},
			},
		]);
		expect(idMapper.getTurn("app-turn-1")).toMatchObject({
			appThreadId: "app-thread-1",
			appTurnId: "app-turn-1",
			externalMessageId: "external-message-1",
		});
	});

	it("tombstones sessions after archive/delete and rejects later turns", async () => {
		const registry = createSessionRegistry();
		const client = new RecordingAppServerClient([
			{ thread: { id: "app-thread-1", session_id: "app-session-1" } },
			{ ok: true },
		]);
		const router = createRequestRouter({
			client,
			idMapper: createIdMapper(),
			sessionRegistry: registry,
		});

		await router.route({
			method: "session/new",
			externalRequestId: "external-request-8",
			params: { externalSessionId: "external-session-1", appParams: { cwd: "/tmp/project" } },
		});
		await router.route({
			method: "session/archive",
			externalRequestId: "external-request-9",
			params: { externalSessionId: "external-session-1" },
		});
		const rejected = await router.route({
			method: "turn/start",
			externalRequestId: "external-request-10",
			params: { externalSessionId: "external-session-1", appParams: { input: [{ text: "too late" }] } },
		});

		expect(registry.getByExternalSessionId("external-session-1")).toMatchObject({ tombstoned: true });
		expect(rejected).toMatchObject({
			kind: "adapter-error",
			error: {
				data: {
					source: "pi-codex-app-server",
					adapterCode: "invalid-session-state",
				},
			},
		});
		expect(client.calls.map((call) => call.method)).toEqual(["thread/start", "thread/archive"]);
	});
});
