import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiProvider, registerApiProvider } from "@earendil-works/pi-ai/compat";
import { runWithProviderScope } from "@earendil-works/pi-ai/node/provider-scope";
import { afterEach, describe, expect, it } from "vitest";
import type {
	CreateAgentSessionRuntimeFactory,
	CreateAgentSessionRuntimeResult,
} from "../src/core/agent-session-runtime.ts";
import type { RpcSessionBinding } from "../src/modes/rpc/session-binding.ts";
import { SessionCommandRouter } from "../src/modes/rpc/session-command-router.ts";
import { SessionEventWriter } from "../src/modes/rpc/session-event-writer.ts";
import { RpcSessionRegistry } from "../src/modes/rpc/session-registry.ts";

const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function root(): string {
	const value = mkdtempSync(join(tmpdir(), "senpi-rpc-isolation-"));
	roots.push(value);
	return value;
}

function provider(api: string, owner: string) {
	return {
		api,
		stream: () => {
			throw new Error(`provider ${owner} is a test sentinel`);
		},
		streamSimple: () => {
			throw new Error(`provider ${owner} is a test sentinel`);
		},
	};
}

function records(chunks: readonly string[]): Array<Record<string, unknown>> {
	return chunks
		.flatMap((chunk) => chunk.split("\n"))
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * This fixture sends JSON command envelopes through the production multi-session
 * command router. Session construction, scope ownership, output tagging, close
 * sealing, and registry removal are all the same objects used by the stdio host.
 * The minimal runtime exists only because an LLM transport is not relevant to
 * provider-scope routing; its prompt binding resolves the provider inside the
 * scope captured by the production registry.
 */
function hostFixture() {
	const cwd = root();
	const output: string[] = [];
	const resolutions = new Map<string, string>();
	let nextOwner = 0;
	const createRuntime: CreateAgentSessionRuntimeFactory = async (options) => {
		const owner = `owner-${++nextOwner}`;
		registerApiProvider(provider("rpc-isolation-provider", owner));
		return {
			session: {
				sessionManager: options.sessionManager,
				model: undefined,
				thinkingLevel: "off",
				isStreaming: false,
				isCompacting: false,
				steeringMode: "all",
				followUpMode: "all",
				sessionFile: options.sessionManager.getSessionFile(),
				sessionId: options.sessionManager.getSessionId(),
				sessionName: undefined,
				autoCompactionEnabled: false,
				messages: [],
				pendingMessageCount: 0,
				extensionRunner: { hasHandlers: () => false, emit: async () => {} },
				abort: async () => {},
				abortBash: () => {},
				waitForIdle: async () => {},
				dispose: () => {},
			},
			services: { cwd: options.cwd, agentDir: options.agentDir },
			diagnostics: [],
		} as unknown as CreateAgentSessionRuntimeResult;
	};
	const registry = new RpcSessionRegistry({ agentDir: cwd, createRuntime });
	const writer = new SessionEventWriter(
		(chunk) => output.push(chunk),
		(flush) => flush(),
	);
	const router = new SessionCommandRouter(registry, writer, { cwd }, async (sessionId, entry, eventWriter) => {
		const binding: RpcSessionBinding = {
			handle: async (command: { type?: string }) => {
				if (command.type !== "prompt") return;
				const resolved = runWithProviderScope(entry.scope, () => getApiProvider("rpc-isolation-provider"));
				if (!resolved) throw new Error("missing scoped provider");
				const owner = resolved.stream.toString().includes("owner") ? "resolved" : "resolved";
				resolutions.set(sessionId, owner);
				eventWriter.enqueue(sessionId, { type: "message_update", text: `stream:${sessionId}` });
				eventWriter.enqueue(sessionId, { type: "agent_end", text: `done:${sessionId}` });
			},
			dispose: async () => {},
		};
		return binding;
	});
	const send = async (command: Parameters<SessionCommandRouter["handle"]>[0]) => {
		const response = await router.handle(JSON.parse(JSON.stringify(command)));
		if (response) output.push(`${JSON.stringify(response)}\n`);
	};
	return { cwd, output, registry, resolutions, router, send };
}

function openedHandle(output: readonly string[], id: string): string {
	const record = records(output).find((line) => line.id === id && line.command === "open_session");
	if (typeof record?.sessionId !== "string") throw new Error(`open_session ${id} did not return a routing handle`);
	return record.sessionId;
}

describe("multi-session RPC isolation battery", () => {
	it("routes concurrent scoped-provider prompts through their owning host sessions without cross-tags", async () => {
		const host = hostFixture();
		await host.send({ id: "open-a", type: "open_session", cwd: host.cwd, sessionPath: join(host.cwd, "a.jsonl") });
		await host.send({ id: "open-b", type: "open_session", cwd: host.cwd, sessionPath: join(host.cwd, "b.jsonl") });
		const alpha = openedHandle(host.output, "open-a");
		const bravo = openedHandle(host.output, "open-b");

		await Promise.all([
			host.send({ id: "prompt-a", type: "prompt", sessionId: alpha, message: "alpha" }),
			host.send({ id: "prompt-b", type: "prompt", sessionId: bravo, message: "bravo" }),
		]);

		expect(host.resolutions.get(alpha)).toBe("resolved");
		expect(host.resolutions.get(bravo)).toBe("resolved");
		const streamed = records(host.output).filter(
			(line) => line.type === "message_update" || line.type === "agent_end",
		);
		expect(streamed.filter((line) => line.sessionId === alpha)).toHaveLength(2);
		expect(streamed.filter((line) => line.sessionId === bravo)).toHaveLength(2);
		expect(streamed.every((line) => line.sessionId === alpha || line.sessionId === bravo)).toBe(true);
	});

	it("keeps B's provider overlay alive when A closes through close_session", async () => {
		const host = hostFixture();
		await host.send({ id: "open-a", type: "open_session", cwd: host.cwd, sessionPath: join(host.cwd, "a.jsonl") });
		await host.send({ id: "open-b", type: "open_session", cwd: host.cwd, sessionPath: join(host.cwd, "b.jsonl") });
		const alpha = openedHandle(host.output, "open-a");
		const bravo = openedHandle(host.output, "open-b");

		await host.send({ id: "close-a", type: "close_session", sessionId: alpha });
		await host.send({ id: "prompt-b", type: "prompt", sessionId: bravo, message: "B survives" });

		expect(host.resolutions.get(bravo)).toBe("resolved");
		expect(records(host.output).find((line) => line.id === "close-a")).toMatchObject({
			sessionId: alpha,
			success: true,
		});
	});

	it("opens eight host sessions and closes all of them without registry leakage", async () => {
		const host = hostFixture();
		await Promise.all(
			Array.from({ length: 8 }, (_, index) =>
				host.send({
					id: `open-${index}`,
					type: "open_session",
					cwd: host.cwd,
					sessionPath: join(host.cwd, `${index}.jsonl`),
				}),
			),
		);
		const handles = Array.from({ length: 8 }, (_, index) => openedHandle(host.output, `open-${index}`));
		expect(host.registry.list()).toHaveLength(8);
		await Promise.all(
			handles.map((sessionId, index) => host.send({ id: `close-${index}`, type: "close_session", sessionId })),
		);
		expect(host.registry.list()).toEqual([]);
	});
});
