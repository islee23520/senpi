import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@code-yeongyu/senpi";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodemodeSessionManager } from "../src/extension/session-manager.ts";
import senpiCodemode from "../src/index.ts";
import type { EvalKernelResult, EvalKernelRunInput } from "../src/tool/types.ts";

interface RegisteredHandler {
	readonly event: string;
	readonly handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void;
}

class FakePi {
	readonly tools: string[] = [];
	readonly handlers: RegisteredHandler[] = [];
	registeredTool: Pick<ToolDefinition, "execute"> | undefined;
	registerTool(tool: ToolDefinition): void {
		this.tools.push(tool.name);
		if (tool.name === "eval") this.registeredTool = tool;
	}
	on(event: string, handler: RegisteredHandler["handler"]): void {
		this.handlers.push({ event, handler });
	}
}

class DisposableManager implements CodemodeSessionManager {
	readonly runControllers: AbortController[] = [];
	readonly runStarted = Promise.withResolvers<void>();
	disposeCount = 0;
	getKernelCount = 0;
	async getKernel(): Promise<{
		run(input: EvalKernelRunInput): Promise<EvalKernelResult>;
		interrupt(): Promise<void>;
		deliverToolReply(): void;
		reset(): Promise<void>;
		close(): Promise<void>;
	}> {
		this.getKernelCount++;
		const controller = new AbortController();
		this.runControllers.push(controller);
		return {
			run: async (input) => {
				this.runStarted.resolve();
				return await new Promise((resolve) => {
					controller.signal.addEventListener(
						"abort",
						() =>
							resolve({
								type: "result",
								cellId: input.cellId,
								ok: false,
								error: { message: "kernel disposed" },
								durationMs: 0,
							}),
						{ once: true },
					);
				});
			},
			interrupt: async () => undefined,
			deliverToolReply: () => undefined,
			reset: async () => undefined,
			close: async () => undefined,
		};
	}
	async dispose(): Promise<void> {
		this.disposeCount++;
		for (const controller of this.runControllers) controller.abort();
	}
	async complete(): Promise<{
		readonly text: string;
		readonly details: { readonly model: string; readonly structured: false };
	}> {
		return { text: "ok", details: { model: "fake/fake-model", structured: false } };
	}
}

const model = {
	id: "fake-model",
	name: "Fake Model",
	provider: "fake",
	api: "fake-api",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1000,
	maxTokens: 100,
};

type FakeModel = typeof model;

function context(
	registry: { getApiKeyAndHeaders: (input: FakeModel) => Promise<unknown> },
	currentModel?: FakeModel | null,
): ExtensionContext {
	return Object.assign(Object.create(null), {
		model: currentModel === undefined ? model : (currentModel ?? undefined),
		modelRegistry: registry,
		signal: undefined,
	});
}

function extensionApi(pi: FakePi): ExtensionAPI {
	return Object.assign(Object.create(null), {
		registerTool: (tool: ToolDefinition) => pi.registerTool(tool),
		on: (event: string, handler: RegisteredHandler["handler"]) => pi.on(event, handler),
		executeTool: async () => {
			throw new Error("nested tool execution was not expected");
		},
	});
}

async function emit(pi: FakePi, event: string, payload: unknown, ctx: ExtensionContext): Promise<void> {
	for (const entry of pi.handlers.filter((handler) => handler.event === event)) {
		await entry.handler(payload, ctx);
	}
}

describe("senpi-codemode extension factory", () => {
	afterEach(() => vi.clearAllMocks());

	it("registers eval exactly once and has no module side effects", () => {
		const pi = new FakePi();
		const managers: DisposableManager[] = [];

		senpiCodemode(extensionApi(pi), {
			createSessionManager: () => {
				const manager = new DisposableManager();
				managers.push(manager);
				return manager;
			},
		});

		expect(pi.tools).toEqual(["eval"]);
		expect(managers).toEqual([]);
	});

	it("creates a fresh manager on start/reload and disposes on shutdown, switch, and fork", async () => {
		const pi = new FakePi();
		const managers: DisposableManager[] = [];
		senpiCodemode(extensionApi(pi), {
			createSessionManager: () => {
				const manager = new DisposableManager();
				managers.push(manager);
				return manager;
			},
		});
		const ctx = context({ getApiKeyAndHeaders: vi.fn() });

		await emit(pi, "session_start", { reason: "startup" }, ctx);
		await emit(pi, "session_start", { reason: "reload" }, ctx);
		await emit(pi, "session_before_switch", {}, ctx);
		await emit(pi, "session_start", { reason: "switch" }, ctx);
		await emit(pi, "session_before_fork", {}, ctx);
		await emit(pi, "session_start", { reason: "fork" }, ctx);
		await emit(pi, "session_shutdown", {}, ctx);

		expect(managers).toHaveLength(4);
		expect(managers.map((manager) => manager.disposeCount)).toEqual([1, 1, 1, 1]);
	});
});

describe("senpi-codemode extension lifecycle", () => {
	it("settles a mid-run cell as an error and rejects post-shutdown work", async () => {
		const pi = new FakePi();
		const manager = new DisposableManager();
		senpiCodemode(extensionApi(pi), { createSessionManager: () => manager });
		const ctx = context({ getApiKeyAndHeaders: vi.fn() });
		await emit(pi, "session_start", { reason: "startup" }, ctx);
		const tool = pi.registeredTool;
		expect(tool).toBeDefined();
		const run = tool?.execute("cell-running", { language: "js", code: "await pending()" }, undefined, undefined, ctx);
		await manager.runStarted.promise;
		await emit(pi, "session_shutdown", {}, ctx);

		await expect(run).resolves.toMatchObject({ details: expect.objectContaining({ isError: true }) });
		await expect(
			tool?.execute("after-shutdown", { language: "js", code: "1" }, undefined, undefined, ctx),
		).rejects.toThrow("session has not started");
		expect(manager.disposeCount).toBe(1);
		expect(manager.getKernelCount).toBe(1);
		expect(manager.runControllers[0]?.signal.aborted).toBe(true);
	});
});
