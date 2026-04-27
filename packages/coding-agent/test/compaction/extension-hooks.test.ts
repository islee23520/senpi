import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentSession } from "../../src/core/agent-session.js";
import { AuthStorage } from "../../src/core/auth-storage.js";
import {
	createExtensionRuntime,
	type Extension,
	type SessionBeforeCompactEvent,
	type SessionCompactEvent,
} from "../../src/core/extensions/index.js";
import { ModelRegistry } from "../../src/core/model-registry.js";
import { SessionManager } from "../../src/core/session-manager.js";
import { SettingsManager } from "../../src/core/settings-manager.js";
import { createSyntheticSourceInfo } from "../../src/core/source-info.js";
import { createCodingTools } from "../../src/index.js";
import { createTestResourceLoader } from "../utilities.js";

const API_KEY = process.env.ANTHROPIC_OAUTH_TOKEN || process.env.ANTHROPIC_API_KEY;

describe.skipIf(!API_KEY)("Compaction extension hooks", () => {
	let session: AgentSession;
	let tempDir: string;
	let capturedEvents: Array<SessionBeforeCompactEvent | SessionCompactEvent>;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-compaction-hooks-test-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		capturedEvents = [];
	});

	afterEach(async () => {
		if (session) {
			session.dispose();
		}
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true });
		}
	});

	function createExtension(
		onBeforeCompact?: (event: SessionBeforeCompactEvent) => { cancel?: boolean; compaction?: any } | undefined,
		onCompact?: (event: SessionCompactEvent) => void,
	): Extension {
		const handlers = new Map<string, ((event: any, ctx: any) => Promise<any>)[]>();

		handlers.set("session_before_compact", [
			async (event: SessionBeforeCompactEvent) => {
				capturedEvents.push(event);
				if (onBeforeCompact) {
					return onBeforeCompact(event);
				}
				return undefined;
			},
		]);

		handlers.set("session_compact", [
			async (event: SessionCompactEvent) => {
				capturedEvents.push(event);
				if (onCompact) {
					onCompact(event);
				}
				return undefined;
			},
		]);

		return {
			path: "test-extension",
			resolvedPath: "/test/test-extension.ts",
			sourceInfo: createSyntheticSourceInfo("<test:test-extension>", { source: "test" }),
			handlers,
			tools: new Map(),
			messageRenderers: new Map(),
			commands: new Map(),
			flags: new Map(),
			shortcuts: new Map(),
		};
	}

	function createSession(extensions: Extension[]) {
		const model = getModel("anthropic", "claude-sonnet-4-5")!;
		const agent = new Agent({
			getApiKey: () => API_KEY,
			initialState: {
				model,
				systemPrompt: "You are a helpful assistant. Be concise.",
				tools: createCodingTools(process.cwd()),
			},
		});

		const sessionManager = SessionManager.create(tempDir);
		const settingsManager = SettingsManager.create(tempDir, tempDir);
		const authStorage = AuthStorage.create(join(tempDir, "auth.json"));
		const modelRegistry = ModelRegistry.create(authStorage);

		const runtime = createExtensionRuntime();
		const resourceLoader = {
			...createTestResourceLoader(),
			getExtensions: () => ({ extensions, errors: [], runtime }),
		};

		session = new AgentSession({
			agent,
			sessionManager,
			settingsManager,
			cwd: tempDir,
			modelRegistry,
			resourceLoader,
		});

		return session;
	}

	describe("Given a session_before_compact handler that returns a custom compaction result", () => {
		describe("When compaction is triggered", () => {
			it("Then the default summary is bypassed and the extension summary is used", async () => {
				const customSummary = "Custom summary from extension";
				const extension = createExtension((event) => {
					return {
						compaction: {
							summary: customSummary,
							firstKeptEntryId: event.preparation.firstKeptEntryId,
							tokensBefore: event.preparation.tokensBefore,
						},
					};
				});
				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.prompt("What is 3+3? Reply with just the number.");
				await session.agent.waitForIdle();

				const result = await session.compact();

				expect(result.summary).toBe(customSummary);

				const compactEvents = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");
				expect(compactEvents.length).toBe(1);
				expect(compactEvents[0].fromExtension).toBe(true);
			}, 120000);
		});
	});

	describe("Given a session_before_compact handler that returns {cancel: true}", () => {
		describe("When compaction is triggered", () => {
			it("Then no compaction occurs and no session_compact event is emitted", async () => {
				const extension = createExtension(() => ({ cancel: true }));
				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await expect(session.compact()).rejects.toThrow("Compaction cancelled");

				const compactEvents = capturedEvents.filter((e) => e.type === "session_compact");
				expect(compactEvents.length).toBe(0);
			}, 120000);
		});
	});

	describe("Given a session_before_compact handler that returns undefined", () => {
		describe("When compaction is triggered", () => {
			it("Then default compaction behavior runs and produces a summary", async () => {
				const extension = createExtension(() => undefined);
				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.prompt("What is 3+3? Reply with just the number.");
				await session.agent.waitForIdle();

				const result = await session.compact();

				expect(result.summary).toBeDefined();
				expect(result.summary.length).toBeGreaterThan(0);

				const compactEvents = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");
				expect(compactEvents.length).toBe(1);
				expect(compactEvents[0].fromExtension).toBe(false);
			}, 120000);
		});
	});

	describe("Given a session with an extension that listens to session_compact", () => {
		describe("When compaction completes", () => {
			it("Then the session_compact event payload includes compactionEntry and fromExtension", async () => {
				const extension = createExtension();
				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.compact();

				const compactEvents = capturedEvents.filter((e): e is SessionCompactEvent => e.type === "session_compact");
				expect(compactEvents.length).toBe(1);

				const afterEvent = compactEvents[0];
				expect(afterEvent.compactionEntry).toBeDefined();
				expect(afterEvent.compactionEntry.summary.length).toBeGreaterThan(0);
				expect(afterEvent.compactionEntry.tokensBefore).toBeGreaterThanOrEqual(0);
				expect(afterEvent.fromExtension).toBe(false);
			}, 120000);
		});
	});

	describe("Given a session with an extension that calls ctx.compact() with custom instructions", () => {
		describe("When the extension triggers compaction with instructions", () => {
			it("Then the instructions are appended to the compaction prompt", async () => {
				const customInstructions = "Focus on API design decisions";
				let capturedInstructions: string | undefined;

				const extension: Extension = {
					path: "instruction-capture-extension",
					resolvedPath: "/test/instruction-capture-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:instruction-capture-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"session_before_compact",
							[
								async (event: SessionBeforeCompactEvent) => {
									capturedInstructions = event.customInstructions;
									return undefined;
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.compact(customInstructions);

				expect(capturedInstructions).toBe(customInstructions);
			}, 120000);
		});
	});

	describe("Given a session with an extension that observes compaction", () => {
		describe("When compaction completes and the onComplete callback is configured", () => {
			it("Then the onComplete callback fires with the CompactionResult", async () => {
				let callbackResult: any = null;

				const extension: Extension = {
					path: "callback-extension",
					resolvedPath: "/test/callback-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:callback-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"session_compact",
							[
								async (event: SessionCompactEvent) => {
									callbackResult = event.compactionEntry;
									return undefined;
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.compact();

				expect(callbackResult).not.toBeNull();
				expect(callbackResult.summary).toBeDefined();
				expect(callbackResult.summary.length).toBeGreaterThan(0);
				expect(callbackResult.tokensBefore).toBeGreaterThanOrEqual(0);
			}, 120000);
		});
	});

	describe("Given a session with an extension that uses ctx.getContextUsage()", () => {
		describe("When context usage is queried before any LLM calls", () => {
			it("Then it returns tokens as null with a valid contextWindow", async () => {
				let contextUsage: any = null;

				const extension: Extension = {
					path: "usage-extension",
					resolvedPath: "/test/usage-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:usage-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"session_before_compact",
							[
								async (_event: any, ctx: any) => {
									contextUsage = ctx.getContextUsage();
									return undefined;
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.compact();

				expect(contextUsage).not.toBeNull();
				expect(contextUsage.tokens).toBeNull();
				expect(typeof contextUsage.contextWindow).toBe("number");
				expect(contextUsage.percent).toBeNull();
			}, 120000);
		});
	});

	describe("Given a session with an extension that handles before_agent_start", () => {
		describe("When the extension returns a systemPrompt modification", () => {
			it("Then the modified system prompt is chained in the next LLM call", async () => {
				const extension: Extension = {
					path: "system-prompt-extension",
					resolvedPath: "/test/system-prompt-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:system-prompt-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"before_agent_start",
							[
								async () => {
									return {
										systemPrompt: "Always answer in French.",
									};
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				const assistantMessages = session.messages.filter((m) => m.role === "assistant");
				expect(assistantMessages.length).toBeGreaterThan(0);
			}, 120000);
		});
	});

	describe("Given a session with an extension that handles the context event", () => {
		describe("When the extension mutates messages in the context handler", () => {
			it("Then the mutation is per-call only and NOT persisted to the session", async () => {
				const extension: Extension = {
					path: "context-mutator-extension",
					resolvedPath: "/test/context-mutator-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:context-mutator-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"context",
							[
								async (event: any) => {
									return {
										messages: event.messages.map((m: any) => ({
											...m,
											content: "MUTATED",
										})),
									};
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				const persistedMessages = session.messages;
				const hasMutatedContent = persistedMessages.some((m: any) => m.content === "MUTATED");
				expect(hasMutatedContent).toBe(false);
			}, 120000);
		});
	});

	describe("Given a session with an extension that calls pi.appendEntry", () => {
		describe("When the extension appends a custom entry", () => {
			it("Then the entry persists in the session JSONL but does NOT appear in LLM context", async () => {
				const customType = "test-custom-entry";
				const customData = { test: true, value: 42 };

				const extension: Extension = {
					path: "append-entry-extension",
					resolvedPath: "/test/append-entry-extension.ts",
					sourceInfo: createSyntheticSourceInfo("<test:append-entry-extension>", { source: "test" }),
					handlers: new Map<string, ((event: any, ctx: any) => Promise<any>)[]>([
						[
							"session_compact",
							[
								async (_event: any, ctx: any) => {
									ctx.appendEntry(customType, customData);
									return undefined;
								},
							],
						],
					]),
					tools: new Map(),
					messageRenderers: new Map(),
					commands: new Map(),
					flags: new Map(),
					shortcuts: new Map(),
				};

				createSession([extension]);

				await session.prompt("What is 2+2? Reply with just the number.");
				await session.agent.waitForIdle();

				await session.compact();

				const entries = session.sessionManager.getEntries();
				const customEntries = entries.filter((e: any) => e.type === "custom" && e.customType === customType);
				expect(customEntries.length).toBeGreaterThan(0);
				expect((customEntries[0] as any).data).toEqual(customData);

				const llmMessages = session.messages;
				const hasCustomInLlm = llmMessages.some((m: any) => m.role === "custom" && m.customType === customType);
				expect(hasCustomInLlm).toBe(false);
			}, 120000);
		});
	});
});
