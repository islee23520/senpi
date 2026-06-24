import { describe, expect, it } from "vitest";
import { createIdMapper } from "../../src/core/extensions/builtin/pi-codex-app-server/id-mapper.ts";
import {
	type AppServerCallbackClient,
	createServerRequestBridge,
} from "../../src/core/extensions/builtin/pi-codex-app-server/server-request-bridge.ts";
import { createSessionRegistry } from "../../src/core/extensions/builtin/pi-codex-app-server/session-registry.ts";

class RecordingCallbackClient implements AppServerCallbackClient {
	readonly responses: { readonly appRequestId: string; readonly response: unknown }[] = [];
	readonly rejections: { readonly appRequestId: string; readonly reason: string }[] = [];

	async respond(appRequestId: string, response: unknown): Promise<void> {
		this.responses.push({ appRequestId, response });
	}

	async reject(appRequestId: string, reason: string): Promise<void> {
		this.rejections.push({ appRequestId, reason });
	}
}

function createBridgeFixture(nowMs = 1000) {
	const idMapper = createIdMapper(() => nowMs);
	const sessionRegistry = createSessionRegistry();
	const bindResult = sessionRegistry.bindSession({
		externalSessionId: "external-session-1",
		appThreadId: "app-thread-1",
		appSessionId: "app-session-1",
	});
	expect(bindResult.kind).toBe("bound");
	const callbackClient = new RecordingCallbackClient();
	const bridge = createServerRequestBridge({
		connectionId: "connection-1",
		capabilityFlags: ["opaque-callbacks"],
		callbackTimeoutMs: 5000,
		nowMs: () => nowMs,
		idMapper,
		sessionRegistry,
		callbackClient,
	});
	return { bridge, callbackClient, idMapper };
}

describe("pi-codex-app-server server-request callback bridge", () => {
	it("delivers command approval callbacks losslessly without auto-approval", async () => {
		const { bridge, callbackClient, idMapper } = createBridgeFixture();

		const delivered = bridge.deliver({
			method: "item/commandExecution/requestApproval",
			requestId: "app-request-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-command-1",
				startedAtMs: 1000,
				command: "npm test",
				cwd: "/repo",
				availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
			},
		});

		expect(delivered).toMatchObject({
			kind: "delivered",
			request: {
				kind: "opaque-request",
				method: "appServer/request",
				externalCallbackId: "callback-app-request-1",
				timeoutAtMs: 6000,
				envelope: {
					connectionId: "connection-1",
					externalSessionId: "external-session-1",
					externalCallbackId: "callback-app-request-1",
					appThreadId: "app-thread-1",
					appSessionId: "app-session-1",
					appTurnId: "app-turn-1",
					appItemId: "app-command-1",
					appRequestId: "app-request-1",
					sequence: 1,
					streamClass: "lossless",
					originalMethod: "item/commandExecution/requestApproval",
					redactionClass: "public-contract",
				},
			},
		});
		expect(callbackClient.responses).toEqual([]);
		expect(idMapper.getServerRequest("app-request-1")).toMatchObject({
			appRequestId: "app-request-1",
			externalCallbackId: "callback-app-request-1",
			method: "item/commandExecution/requestApproval",
		});

		const response = await bridge.respond({
			externalCallbackId: "callback-app-request-1",
			response: { decision: "acceptForSession" },
		});

		expect(response).toEqual({ kind: "forwarded" });
		expect(callbackClient.responses).toEqual([
			{ appRequestId: "app-request-1", response: { decision: "acceptForSession" } },
		]);
	});

	it("routes file and permission callback rejection without converting it to approval", async () => {
		const { bridge, callbackClient } = createBridgeFixture();
		bridge.deliver({
			method: "item/fileChange/requestApproval",
			requestId: "app-request-file-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-file-1",
				startedAtMs: 1000,
				reason: "Needs write access",
			},
		});
		bridge.deliver({
			method: "item/permissions/requestApproval",
			requestId: "app-request-permission-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-permission-1",
				startedAtMs: 1000,
				cwd: "/repo",
				reason: "Need workspace write",
				permissions: { fileSystem: { write: ["/repo"] } },
			},
		});

		const fileRejection = await bridge.reject({
			externalCallbackId: "callback-app-request-file-1",
			reason: "user declined patch",
		});
		const permissionRejection = await bridge.reject({
			externalCallbackId: "callback-app-request-permission-1",
			reason: "permission denied",
		});

		expect(fileRejection).toEqual({ kind: "forwarded" });
		expect(permissionRejection).toEqual({ kind: "forwarded" });
		expect(callbackClient.responses).toEqual([]);
		expect(callbackClient.rejections).toEqual([
			{ appRequestId: "app-request-file-1", reason: "user declined patch" },
			{ appRequestId: "app-request-permission-1", reason: "permission denied" },
		]);
	});

	it("delivers request_user_input and redacts secret answers from evidence", async () => {
		const { bridge, callbackClient } = createBridgeFixture();
		const delivered = bridge.deliver({
			method: "item/tool/requestUserInput",
			requestId: "app-request-input-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-tool-1",
				questions: [
					{
						id: "token",
						header: "Token",
						question: "Enter token",
						isSecret: true,
						options: null,
					},
				],
				autoResolutionMs: 60000,
			},
		});

		expect(delivered).toMatchObject({
			kind: "delivered",
			request: {
				envelope: {
					originalMethod: "item/tool/requestUserInput",
					redactionClass: "secret-bearing",
				},
			},
		});
		await bridge.respond({
			externalCallbackId: "callback-app-request-input-1",
			response: { answers: { token: { answers: ["super-secret-token"] } } },
		});

		expect(callbackClient.responses).toEqual([
			{
				appRequestId: "app-request-input-1",
				response: { answers: { token: { answers: ["super-secret-token"] } } },
			},
		]);
		expect(
			bridge.redactCallbackResponse("callback-app-request-input-1", callbackClient.responses[0]?.response),
		).toEqual({
			answers: { token: { answers: ["[REDACTED]"] } },
		});
	});

	it("rejects timed-out callbacks and clears mappings after serverRequest/resolved", async () => {
		const { bridge, callbackClient, idMapper } = createBridgeFixture(1000);
		bridge.deliver({
			method: "item/commandExecution/requestApproval",
			requestId: "app-request-timeout-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-command-1",
				startedAtMs: 1000,
				command: "rm -rf tmp",
			},
		});

		const expired = await bridge.rejectTimedOutCallbacks(7001);
		const late = await bridge.respond({
			externalCallbackId: "callback-app-request-timeout-1",
			response: { decision: "accept" },
		});

		expect(expired).toEqual([
			{ appRequestId: "app-request-timeout-1", externalCallbackId: "callback-app-request-timeout-1" },
		]);
		expect(callbackClient.rejections).toEqual([
			{ appRequestId: "app-request-timeout-1", reason: "callback timed out" },
		]);
		expect(late).toMatchObject({
			kind: "adapter-error",
			error: { data: { adapterCode: "invalid-callback-state" } },
		});

		bridge.deliver({
			method: "item/commandExecution/requestApproval",
			requestId: "app-request-resolved-1",
			params: {
				threadId: "app-thread-1",
				turnId: "app-turn-1",
				itemId: "app-command-2",
				startedAtMs: 1000,
			},
		});
		const resolved = bridge.resolveFromNotification({
			method: "serverRequest/resolved",
			params: { threadId: "app-thread-1", requestId: "app-request-resolved-1" },
		});

		expect(resolved).toEqual({ kind: "resolved", appRequestId: "app-request-resolved-1" });
		expect(idMapper.getServerRequest("app-request-resolved-1")).toBeUndefined();
	});
});
