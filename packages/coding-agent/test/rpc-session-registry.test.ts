import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getApiProvider, registerApiProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, test } from "vitest";
import {
	AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type CreateAgentSessionRuntimeResult,
} from "../src/core/agent-session-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { type RpcSessionLaunchProfile, RpcSessionRegistry } from "../src/modes/rpc/session-registry.ts";

const profile = (cwd: string, sessionPath: string): RpcSessionLaunchProfile => ({
	cwd,
	sessionPath,
	permissionPreset: "default",
	creationModel: { provider: "test", modelId: "model" },
	initialThinkingLevel: "high",
});

function runtime(
	options: Parameters<CreateAgentSessionRuntimeFactory>[0],
	controls?: { waitForIdle?: () => Promise<void> },
) {
	return {
		session: {
			sessionManager: options.sessionManager,
			extensionRunner: { hasHandlers: () => false, emit: async () => {} },
			abort: async () => {},
			abortBash: () => {},
			waitForIdle: controls?.waitForIdle ?? (async () => {}),
			dispose: () => {},
		},
		services: { cwd: options.cwd, agentDir: options.agentDir },
		diagnostics: [],
	} as unknown as CreateAgentSessionRuntimeResult;
}

describe("RPC session registry", () => {
	const directories: string[] = [];
	afterEach(async () => {
		await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
	});

	async function createRegistry() {
		const dir = await mkdtemp(join(tmpdir(), "senpi-rpc-registry-"));
		directories.push(dir);
		return {
			dir,
			registry: new RpcSessionRegistry({
				agentDir: dir,
				createRuntime: async (options) => runtime(options),
			}),
		};
	}

	test("opens independent sessions with distinct opaque handles", async () => {
		const { dir, registry } = await createRegistry();
		const first = await registry.openSession(profile(dir, join(dir, "first.jsonl")));
		const second = await registry.openSession(profile(dir, join(dir, "second.jsonl")));

		expect(first.sessionId).not.toBe(second.sessionId);
		expect(first.durableSessionId).not.toBe(second.durableSessionId);
		expect(registry.list()).toHaveLength(2);
	});

	test("reserves a canonical path before asynchronous runtime construction", async () => {
		const { dir } = await createRegistry();
		let release!: () => void;
		const opened = new Promise<void>((resolve) => {
			release = resolve;
		});
		const registry = new RpcSessionRegistry({
			agentDir: dir,
			createRuntime: async (options) => {
				await opened;
				return runtime(options);
			},
		});
		const samePath = join(dir, "same.jsonl");
		const first = registry.openSession(profile(dir, samePath));
		await expect(registry.openSession(profile(dir, samePath))).rejects.toMatchObject({ code: "session_path_in_use" });
		release();
		await first;
	});

	test("rejects commands while closing, then releases the reservation after disposal", async () => {
		const { dir } = await createRegistry();
		let releaseIdle!: () => void;
		const idle = new Promise<void>((resolve) => {
			releaseIdle = resolve;
		});
		let disposed = false;
		const registry = new RpcSessionRegistry({
			agentDir: dir,
			createRuntime: async (options) => {
				const result = runtime(options, { waitForIdle: () => idle });
				const dispose = result.session.dispose;
				result.session.dispose = () => {
					disposed = true;
					dispose();
				};
				return result;
			},
		});
		const path = join(dir, "closing.jsonl");
		const opened = await registry.openSession(profile(dir, path));
		const closing = registry.close(opened.sessionId);

		expect(() => registry.getForCommand(opened.sessionId, "prompt")).toThrow(/session_closing/);
		expect(registry.getForCommand(opened.sessionId, "abort").state).toBe("closing");
		releaseIdle();
		await closing;
		expect(disposed).toBe(true);
		await expect(registry.openSession(profile(dir, path))).resolves.toMatchObject({ sessionId: expect.any(String) });
	});

	test("returns unknown_session for an unknown or terminal handle", async () => {
		const { dir, registry } = await createRegistry();
		await expect(registry.close("does-not-exist")).rejects.toMatchObject({ code: "unknown_session" });
		const opened = await registry.openSession(profile(dir, join(dir, "closed.jsonl")));
		await registry.close(opened.sessionId);
		await expect(registry.close(opened.sessionId)).rejects.toMatchObject({ code: "unknown_session" });
	});

	test("constructs each opened runtime inside an isolated provider scope", async () => {
		const { dir } = await createRegistry();
		const api = "rpc-session-scope-test";
		const providersSeenDuringConstruction: Array<unknown> = [];
		const registry = new RpcSessionRegistry({
			agentDir: dir,
			createRuntime: async (options) => {
				if (providersSeenDuringConstruction.length === 0) {
					await Promise.resolve();
					registerApiProvider({
						api,
						stream: () => {
							throw new Error("not invoked");
						},
						streamSimple: () => {
							throw new Error("not invoked");
						},
					});
				}
				providersSeenDuringConstruction.push(getApiProvider(api));
				return runtime(options);
			},
		});

		await registry.openSession(profile(dir, join(dir, "scope-a.jsonl")));
		await registry.openSession(profile(dir, join(dir, "scope-b.jsonl")));

		expect(providersSeenDuringConstruction[0]).toBeDefined();
		expect(providersSeenDuringConstruction[1]).toBeUndefined();
	});

	test("keeps the immutable launch profile across new_session runtime replacement", async () => {
		const dir = await mkdtemp(join(tmpdir(), "senpi-runtime-profile-"));
		directories.push(dir);
		const launchProfile = Object.freeze(profile(dir, join(dir, "profile.jsonl")));
		const manager = SessionManager.create(dir, dir);
		const captured: Array<RpcSessionLaunchProfile | undefined> = [];
		const fakeSession = (sessionManager: SessionManager) =>
			({
				sessionManager,
				extensionRunner: { hasHandlers: () => false },
				dispose: () => {},
			}) as never;
		const factory: CreateAgentSessionRuntimeFactory = async (options) => {
			captured.push(options.launchProfile as RpcSessionLaunchProfile | undefined);
			return {
				session: fakeSession(options.sessionManager),
				services: { cwd: options.cwd, agentDir: dir },
				diagnostics: [],
			} as unknown as CreateAgentSessionRuntimeResult;
		};
		const initial = await factory({ cwd: dir, agentDir: dir, sessionManager: manager, launchProfile });
		const session = new AgentSessionRuntime(initial.session, initial.services, factory, [], undefined, launchProfile);

		await session.newSession();
		expect(captured).toEqual([launchProfile, launchProfile]);
		expect(session.launchProfile).toBe(launchProfile);
		expect(existsSync(manager.getSessionDir())).toBe(true);
	});
});
