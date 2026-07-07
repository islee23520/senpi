/**
 * Auth RPC commands + events (plan task 13, Deliverable A).
 *
 * The neo TUI drives /login and /logout over the RPC protocol. This suite pins
 * the five additive auth commands and the two additive login-completion events,
 * plus the custom_unsupported capability gate. It is additive-only: existing RPC
 * command/response shapes are untouched, and a default (unflagged) client sees
 * byte-identical behavior.
 *
 * Login uses a STUB oauth provider (never a real key/token): AuthStorage.login is
 * exercised against a faux provider whose `login()` drives onAuth then resolves
 * with clearly-fake credentials, so the whole flow is hermetic. No real ~/.senpi
 * is touched — every test writes to a per-test temp agent dir.
 */

import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import { type AssistantMessage, type AssistantMessageEvent, EventStream, getModel } from "@earendil-works/pi-ai/compat";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSession } from "../src/core/agent-session.ts";
import type { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import { createRpcConnectionHandler, type RpcConnectionSink } from "../src/modes/rpc/connection-handler.ts";
import { buildCustomUnsupportedRequest } from "../src/modes/rpc/custom-capability.ts";
import { createTestResourceLoader } from "./utilities.ts";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

function assistantMessage(text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-sonnet-4-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

interface Harness {
	runtimeHost: AgentSessionRuntime;
	authStorage: AuthStorage;
	authPath: string;
	cleanup: () => void;
}

function makeHarness(tempDir: string): Harness {
	const model = getModel("anthropic", "claude-sonnet-4-5");
	if (!model) throw new Error("model not found");
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: "Test", tools: [] },
		streamFn: () => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "start", partial: assistantMessage("") });
				stream.push({ type: "done", reason: "stop", message: assistantMessage("done") });
			});
			return stream;
		},
	});
	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.create(tempDir, tempDir);
	const authPath = join(tempDir, "auth.json");
	const authStorage = AuthStorage.create(authPath);
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = ModelRegistry.create(authStorage, tempDir);
	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd: tempDir,
		modelRegistry,
		resourceLoader: createTestResourceLoader(),
	});
	const runtimeHost = {
		session,
		newSession: vi.fn(async () => ({ cancelled: true })),
		switchSession: vi.fn(async () => ({ cancelled: true })),
		fork: vi.fn(async () => ({ cancelled: true, selectedText: "" })),
		dispose: vi.fn(async () => {}),
		setRebindSession: vi.fn(),
	} as unknown as AgentSessionRuntime;
	return { runtimeHost, authStorage, authPath, cleanup: () => session.dispose() };
}

/** Collect emitted JSONL objects from the sink. */
function makeSink(): { sink: RpcConnectionSink; messages: () => Array<Record<string, unknown>> } {
	const lines: string[] = [];
	const sink: RpcConnectionSink = {
		writeRaw: (chunk) => lines.push(chunk),
		waitForBackpressure: async () => {},
	};
	return {
		sink,
		messages: () =>
			lines
				.join("")
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l) as Record<string, unknown>),
	};
}

async function flush(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("neo auth RPC commands", () => {
	let tempDir: string;
	let cleanup: () => void = () => {};

	beforeEach(() => {
		tempDir = join(tmpdir(), `neo-auth-rpc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		cleanup();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("get_auth_providers returns id/name/authType/status entries", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;
		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(JSON.stringify({ id: "p1", type: "get_auth_providers" }));
		const resp = messages().find((m) => m.id === "p1" && m.command === "get_auth_providers");
		expect(resp).toMatchObject({ type: "response", success: true });
		const data = resp?.data as { providers: Array<Record<string, unknown>> };
		expect(Array.isArray(data.providers)).toBe(true);
		// Anthropic is an oauth provider and must be present with a status object.
		const anthropic = data.providers.find((p) => p.id === "anthropic");
		expect(anthropic).toBeDefined();
		expect(anthropic).toMatchObject({ authType: "oauth", name: expect.any(String) });
		expect(anthropic?.status).toMatchObject({ configured: expect.any(Boolean) });
		await handler.dispose();
	});

	it("login_start responds success:true immediately (flow-started) and emits auth_login_url + auth_login_end for a stub provider", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;

		// Stub the AuthStorage.login to drive a fake URL flow and persist clearly
		// fake credentials — no real oauth server, no real token.
		const loginSpy = vi.spyOn(h.authStorage, "login").mockImplementation(async (providerId, callbacks) => {
			callbacks.onAuth({ url: "https://stub.example/oauth?code=FAKE" });
			// Persist obviously-fake oauth credentials directly.
			h.authStorage.set(providerId, {
				type: "oauth",
				access: "FAKE-ACCESS",
				refresh: "FAKE-REFRESH",
				expires: Date.now() + 3_600_000,
			});
		});

		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(JSON.stringify({ id: "l1", type: "login_start", provider: "anthropic" }));
		await flush();

		const msgs = messages();
		// Immediate response = flow started.
		const started = msgs.find((m) => m.id === "l1" && m.command === "login_start");
		expect(started).toMatchObject({ type: "response", success: true });
		// The URL arrives as an EVENT (not a response).
		const urlEvent = msgs.find((m) => m.type === "auth_login_url");
		expect(urlEvent).toMatchObject({ provider: "anthropic", url: "https://stub.example/oauth?code=FAKE" });
		// Completion arrives as an END EVENT.
		const endEvent = msgs.find((m) => m.type === "auth_login_end");
		expect(endEvent).toMatchObject({ provider: "anthropic", success: true });
		expect(loginSpy).toHaveBeenCalledWith("anthropic", expect.anything());
		await handler.dispose();
	});

	it("login_start failure surfaces auth_login_end success:false with error (no secret leak)", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;

		vi.spyOn(h.authStorage, "login").mockImplementation(async () => {
			throw new Error("oauth port busy");
		});

		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(JSON.stringify({ id: "l2", type: "login_start", provider: "anthropic" }));
		await flush();

		const msgs = messages();
		expect(msgs.find((m) => m.id === "l2" && m.command === "login_start")).toMatchObject({ success: true });
		const endEvent = msgs.find((m) => m.type === "auth_login_end");
		expect(endEvent).toMatchObject({ provider: "anthropic", success: false });
		expect(String(endEvent?.error)).toContain("oauth port busy");
		await handler.dispose();
	});

	it("login_cancel aborts an in-flight login and yields auth_login_end success:false", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;

		// A login that never resolves until its signal aborts.
		vi.spyOn(h.authStorage, "login").mockImplementation(async (_providerId, callbacks) => {
			callbacks.onAuth({ url: "https://stub.example/oauth?code=PENDING" });
			await new Promise<void>((_resolve, reject) => {
				callbacks.signal?.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true });
			});
		});

		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(JSON.stringify({ id: "l3", type: "login_start", provider: "anthropic" }));
		await flush();
		await handler.handleInputLine(JSON.stringify({ id: "c1", type: "login_cancel", provider: "anthropic" }));
		await flush();

		const msgs = messages();
		expect(msgs.find((m) => m.id === "c1" && m.command === "login_cancel")).toMatchObject({ success: true });
		const endEvent = msgs.find((m) => m.type === "auth_login_end");
		expect(endEvent).toMatchObject({ provider: "anthropic", success: false });
		await handler.dispose();
	});

	it("login_api_key stores a provider API key credential at 0600 in the sandbox agent dir", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;

		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(
			JSON.stringify({ id: "k1", type: "login_api_key", provider: "openai", key: "sk-FAKEKEY-123" }),
		);

		const resp = messages().find((m) => m.id === "k1" && m.command === "login_api_key");
		expect(resp).toMatchObject({ type: "response", success: true });

		// Credential persisted to the SANDBOX auth.json (never real ~/.senpi).
		const stored = JSON.parse(readFileSync(h.authPath, "utf-8")) as Record<string, { type: string; key: string }>;
		expect(stored.openai).toMatchObject({ type: "api_key", key: "sk-FAKEKEY-123" });
		// File mode must be owner-only (0600).
		expect(statSync(h.authPath).mode & 0o777).toBe(0o600);
		await handler.dispose();
	});

	it("logout removes a stored credential from the sandbox agent dir", async () => {
		const { sink, messages } = makeSink();
		const h = makeHarness(tempDir);
		cleanup = h.cleanup;
		h.authStorage.set("openai", { type: "api_key", key: "sk-FAKEKEY-999" });
		expect(h.authStorage.has("openai")).toBe(true);

		const handler = createRpcConnectionHandler(h.runtimeHost, sink);
		await handler.handleInputLine(JSON.stringify({ id: "o1", type: "logout", provider: "openai" }));

		const resp = messages().find((m) => m.id === "o1" && m.command === "logout");
		expect(resp).toMatchObject({ type: "response", success: true });
		const stored = JSON.parse(readFileSync(h.authPath, "utf-8")) as Record<string, unknown>;
		expect(stored.openai).toBeUndefined();
		await handler.dispose();
	});
});

describe("neo custom_unsupported capability gate", () => {
	// The gate decision is a pure function so the additive-only guarantee is
	// unit-provable: a flagged client gets one wire request; an unflagged (default)
	// client gets nothing (byte-identical to today's undefined-with-no-output).

	it("flagged client: builds an additive custom_unsupported request", () => {
		const req = buildCustomUnsupportedRequest(["custom_unsupported"], "my-third-party-ext");
		expect(req).toMatchObject({
			type: "extension_ui_request",
			method: "custom_unsupported",
			extensionName: "my-third-party-ext",
		});
		expect(typeof (req as { id: string }).id).toBe("string");
	});

	it("unflagged client: emits NO request (byte-identical default)", () => {
		expect(buildCustomUnsupportedRequest([], "my-third-party-ext")).toBeUndefined();
		expect(buildCustomUnsupportedRequest(undefined, "my-third-party-ext")).toBeUndefined();
		// An unrelated capability must not trip the gate.
		expect(buildCustomUnsupportedRequest(["something_else"], "ext")).toBeUndefined();
	});

	it("handler.custom() honors the flag end-to-end via a bound extension context", async () => {
		const tempDir = join(tmpdir(), `neo-custom-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(tempDir, { recursive: true });
		// A no-op custom factory a stub extension would pass to ctx.ui.custom.
		const factory = (() => ({ render: () => "" })) as never;
		try {
			const flaggedSink = makeSink();
			const h1 = makeHarness(tempDir);
			const flagged = createRpcConnectionHandler(h1.runtimeHost, flaggedSink.sink, {
				capabilities: ["custom_unsupported"],
			});
			await flagged.ready;
			const flaggedResult = await h1.runtimeHost.session.extensionRunner.getUIContext().custom(factory);
			expect(flaggedResult).toBeUndefined();
			// Flagged client: exactly one additive custom_unsupported request is emitted.
			expect(
				flaggedSink.messages().find((m) => m.type === "extension_ui_request" && m.method === "custom_unsupported"),
			).toMatchObject({ method: "custom_unsupported", extensionName: expect.any(String) });
			await flagged.dispose();
			h1.cleanup();

			const plainSink = makeSink();
			const h2 = makeHarness(tempDir);
			const plain = createRpcConnectionHandler(h2.runtimeHost, plainSink.sink);
			await plain.ready;
			const plainResult = await h2.runtimeHost.session.extensionRunner.getUIContext().custom(factory);
			expect(plainResult).toBeUndefined();
			// Default client: NO custom_unsupported wire message (byte-identical).
			expect(
				plainSink.messages().find((m) => m.type === "extension_ui_request" && m.method === "custom_unsupported"),
			).toBeUndefined();
			await plain.dispose();
			h2.cleanup();
		} finally {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
