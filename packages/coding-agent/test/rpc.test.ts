import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@earendil-works/pi-agent-core";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MOCK_PROVIDER = "anthropic";
const MOCK_MODEL = "mock-claude-rpc";
const MOCK_API_KEY = "sk-ant-rpc-test";

const PROVIDER_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_OAUTH_TOKEN",
	"OPENAI_API_KEY",
	"AZURE_OPENAI_API_KEY",
	"DEEPSEEK_API_KEY",
	"NVIDIA_API_KEY",
	"GEMINI_API_KEY",
	"GOOGLE_CLOUD_API_KEY",
	"GROQ_API_KEY",
	"CEREBRAS_API_KEY",
	"XAI_API_KEY",
	"FIREWORKS_API_KEY",
	"TOGETHER_API_KEY",
	"OPENROUTER_API_KEY",
	"AI_GATEWAY_API_KEY",
	"ZAI_API_KEY",
	"ZAI_CODING_CN_API_KEY",
	"MISTRAL_API_KEY",
	"MINIMAX_API_KEY",
	"MINIMAX_CN_API_KEY",
	"MOONSHOT_API_KEY",
	"MOONSHOTAI_API_KEY",
	"KIMI_API_KEY",
	"OPENCODE_API_KEY",
	"CLOUDFLARE_API_KEY",
	"HF_TOKEN",
] as const;

interface FakeModelRequest {
	readonly url: string | undefined;
	readonly model: string | undefined;
	readonly apiKeyHeader: string | undefined;
	readonly text: string;
}

interface FakeModelServer {
	readonly origin: string;
	readonly requests: readonly FakeModelRequest[];
	close(): Promise<void>;
}

interface TextContentBlock {
	readonly type: "text";
	readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAddressInfo(value: string | AddressInfo | null): value is AddressInfo {
	return isRecord(value) && typeof value.port === "number";
}

function isTextContentBlock(value: unknown): value is TextContentBlock {
	return isRecord(value) && value.type === "text" && typeof value.text === "string";
}

function textFromContent(value: unknown): string {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => (isTextContentBlock(part) ? part.text : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function requestText(body: unknown): string {
	if (!isRecord(body) || !Array.isArray(body.messages)) return "";
	return body.messages
		.map((message) => (isRecord(message) ? textFromContent(message.content) : ""))
		.filter((text) => text.length > 0)
		.join("\n");
}

function responseTextFor(body: unknown): string {
	const text = requestText(body);
	const uniqueValue = /\bunique-\d+\b/.exec(text)?.[0];
	if (uniqueValue) return uniqueValue;
	if (text.includes("test123")) return "test123";
	if (/summar/i.test(text) || /compact/i.test(text)) return "Summary: the session contains the prior turns.";
	if (/\bok\b/i.test(text)) return "ok";
	if (/hello/i.test(text)) return "hello";
	return "ok";
}

function writeAnthropicSse(res: ServerResponse, text: string, model: string): void {
	res.writeHead(200, {
		"content-type": "text/event-stream",
		"cache-control": "no-cache",
		connection: "keep-alive",
	});
	const send = (event: string, data: Record<string, unknown>) => {
		res.write(`event: ${event}\n`);
		res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`);
	};
	send("message_start", {
		message: {
			id: "msg_rpc_mock",
			type: "message",
			role: "assistant",
			model,
			content: [],
			stop_reason: null,
			stop_sequence: null,
			usage: { input_tokens: 1, output_tokens: 0 },
		},
	});
	send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
	send("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
	send("content_block_stop", { index: 0 });
	send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
	send("message_stop", {});
	res.end();
}

async function startFakeModelServer(): Promise<FakeModelServer> {
	const requests: FakeModelRequest[] = [];
	const server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		req.on("end", () => {
			const raw = Buffer.concat(chunks).toString("utf8");
			const body: unknown = raw ? JSON.parse(raw) : {};
			const model = isRecord(body) && typeof body.model === "string" ? body.model : undefined;
			const text = requestText(body);
			requests.push({
				url: req.url,
				model,
				apiKeyHeader: typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined,
				text,
			});
			if (req.url?.includes("/messages")) {
				writeAnthropicSse(res, responseTextFor(body), model ?? MOCK_MODEL);
				return;
			}
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { message: `no route: ${req.method ?? "GET"} ${req.url ?? "/"}` } }));
		});
	});

	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			const address = server.address();
			if (!isAddressInfo(address)) {
				reject(new Error("Fake model server did not bind to a TCP port"));
				return;
			}
			resolve({
				origin: `http://127.0.0.1:${address.port}`,
				requests,
				close: () =>
					new Promise<void>((resolveClose, rejectClose) => {
						server.close((error) => {
							if (error) {
								rejectClose(error);
								return;
							}
							resolveClose();
						});
					}),
			});
		});
	});
}

function hermeticProviderEnv(): Record<string, string> {
	return Object.fromEntries(PROVIDER_ENV_KEYS.map((key) => [key, ""]));
}

function writeRpcModelsJson(agentDir: string, baseUrl: string): void {
	writeFileSync(
		join(agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					[MOCK_PROVIDER]: {
						baseUrl,
						apiKey: MOCK_API_KEY,
						api: "anthropic-messages",
						models: [
							{
								id: MOCK_MODEL,
								baseUrl,
								api: "anthropic-messages",
								reasoning: true,
								contextWindow: 128000,
								maxTokens: 4096,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
							},
						],
					},
				},
			},
			null,
			2,
		)}\n`,
	);
}

function getAssistantText(events: readonly AgentEvent[]): string | undefined {
	for (const event of events) {
		if (event.type !== "message_end" || event.message.role !== "assistant") continue;
		const textContent = event.message.content.find(isTextContentBlock);
		if (textContent) return textContent.text;
	}
	return undefined;
}

/**
 * RPC mode tests.
 */
describe("RPC mode", () => {
	let client: RpcClient;
	let sessionDir: string;
	let fakeModelServer: FakeModelServer;

	beforeEach(async () => {
		sessionDir = join(tmpdir(), `pi-rpc-test-${Date.now()}`);
		mkdirSync(sessionDir, { recursive: true });
		fakeModelServer = await startFakeModelServer();
		writeRpcModelsJson(sessionDir, fakeModelServer.origin);
		writeFileSync(
			join(sessionDir, "settings.json"),
			`${JSON.stringify({ compaction: { keepRecentTokens: 1 } }, null, 2)}\n`,
		);
		client = new RpcClient({
			cliPath: join(__dirname, "..", "src", "cli.ts"),
			cwd: join(__dirname, ".."),
			env: {
				...hermeticProviderEnv(),
				ANTHROPIC_API_KEY: MOCK_API_KEY,
				PI_OFFLINE: "1",
				SENPI_CODING_AGENT_DIR: sessionDir,
			},
			provider: MOCK_PROVIDER,
			model: MOCK_MODEL,
		});
	});

	afterEach(async () => {
		await client.stop();
		await fakeModelServer.close();
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	test("should get state", async () => {
		await client.start();
		const state = await client.getState();

		expect(state.model).toBeDefined();
		expect(state.model?.provider).toBe(MOCK_PROVIDER);
		expect(state.model?.id).toBe(MOCK_MODEL);
		expect(state.isStreaming).toBe(false);
		expect(state.messageCount).toBe(0);
	}, 30000);

	test("should save messages to session file", async () => {
		await client.start();

		// Send prompt and wait for completion
		const events = await client.promptAndWait("Reply with just the word 'hello'");

		// Should have message events
		const messageEndEvents = events.filter((e) => e.type === "message_end");
		expect(messageEndEvents.length).toBeGreaterThanOrEqual(2); // user + assistant

		// Wait for file writes
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify session file
		const sessionsPath = join(sessionDir, "sessions");
		expect(existsSync(sessionsPath)).toBe(true);

		const sessionDirs = readdirSync(sessionsPath);
		expect(sessionDirs.length).toBeGreaterThan(0);

		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const sessionFiles = readdirSync(cwdSessionDir).filter((f) => f.endsWith(".jsonl"));
		expect(sessionFiles.length).toBe(1);

		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const entries = sessionContent
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		// First entry should be session header
		expect(entries[0].type).toBe("session");

		// Should have user and assistant messages
		const messages = entries.filter((e: { type: string }) => e.type === "message");
		expect(messages.length).toBeGreaterThanOrEqual(2);

		const roles = messages.map((m: { message: { role: string } }) => m.message.role);
		expect(roles).toContain("user");
		expect(roles).toContain("assistant");
	}, 90000);

	test("should handle manual compaction", async () => {
		await client.start();

		await client.promptAndWait("Say hello");
		await client.promptAndWait("Say hello again");

		// Compact
		const result = await client.compact();
		expect(result.summary).toBeDefined();
		expect(result.tokensBefore).toBeGreaterThan(0);

		// Wait for file writes
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify compaction in session file
		const sessionsPath = join(sessionDir, "sessions");
		const sessionDirs = readdirSync(sessionsPath);
		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const sessionFiles = readdirSync(cwdSessionDir).filter((f) => f.endsWith(".jsonl"));
		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const entries = sessionContent
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		const compactionEntries = entries.filter((e: { type: string }) => e.type === "compaction");
		expect(compactionEntries.length).toBe(1);
		expect(compactionEntries[0].summary).toBeDefined();
	}, 120000);

	test("should execute bash command", async () => {
		await client.start();

		const result = await client.bash("echo hello");
		expect(result.output.trim()).toBe("hello");
		expect(result.exitCode).toBe(0);
		expect(result.cancelled).toBe(false);
	}, 30000);

	test("should add bash output to context", async () => {
		await client.start();

		// First send a prompt to initialize session
		await client.promptAndWait("Say hi");

		// Run bash command
		const uniqueValue = `test-${Date.now()}`;
		await client.bash(`echo ${uniqueValue}`);

		// Wait for file writes
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify bash message in session
		const sessionsPath = join(sessionDir, "sessions");
		const sessionDirs = readdirSync(sessionsPath);
		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const sessionFiles = readdirSync(cwdSessionDir).filter((f) => f.endsWith(".jsonl"));
		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const entries = sessionContent
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		const bashMessages = entries.filter(
			(e: { type: string; message?: { role: string } }) =>
				e.type === "message" && e.message?.role === "bashExecution",
		);
		expect(bashMessages.length).toBe(1);
		expect(bashMessages[0].message.output).toContain(uniqueValue);
	}, 90000);

	test("should include bash output in LLM context", async () => {
		await client.start();

		// Run a bash command with a unique value
		const uniqueValue = `unique-${Date.now()}`;
		await client.bash(`echo ${uniqueValue}`);

		// Ask the LLM what the output was
		const events = await client.promptAndWait(
			"What was the exact output of the echo command I just ran? Reply with just the value, nothing else.",
		);

		expect(getAssistantText(events)).toContain(uniqueValue);
	}, 90000);

	test("should set and get thinking level", async () => {
		await client.start();

		// Set thinking level
		await client.setThinkingLevel("high");

		// Verify via state
		const state = await client.getState();
		expect(state.thinkingLevel).toBe("high");
	}, 30000);

	test("should cycle thinking level", async () => {
		await client.start();

		// Get initial level
		const initialState = await client.getState();
		const initialLevel = initialState.thinkingLevel;

		// Cycle
		const result = await client.cycleThinkingLevel();
		expect(result).toBeDefined();
		expect(result!.level).not.toBe(initialLevel);

		// Verify via state
		const newState = await client.getState();
		expect(newState.thinkingLevel).toBe(result!.level);
	}, 30000);

	test("should get available models", async () => {
		await client.start();

		const models = await client.getAvailableModels();
		expect(models.length).toBeGreaterThan(0);

		// All models should have required fields
		for (const model of models) {
			expect(model.provider).toBeDefined();
			expect(model.id).toBeDefined();
			expect(model.contextWindow).toBeGreaterThan(0);
			expect(typeof model.reasoning).toBe("boolean");
		}
	}, 30000);

	test("should get session stats", async () => {
		await client.start();

		// Send a prompt first
		await client.promptAndWait("Hello");

		const stats = await client.getSessionStats();
		expect(stats.sessionFile).toBeDefined();
		expect(stats.sessionId).toBeDefined();
		expect(stats.userMessages).toBeGreaterThanOrEqual(1);
		expect(stats.assistantMessages).toBeGreaterThanOrEqual(1);
	}, 90000);

	test("should create new session", async () => {
		await client.start();

		// Send a prompt
		await client.promptAndWait("Hello");

		// Verify messages exist
		let state = await client.getState();
		expect(state.messageCount).toBeGreaterThan(0);

		// New session
		await client.newSession();

		// Verify messages cleared
		state = await client.getState();
		expect(state.messageCount).toBe(0);
	}, 90000);

	test("should export to HTML", async () => {
		await client.start();

		// Send a prompt first
		await client.promptAndWait("Hello");

		// Export
		const result = await client.exportHtml();
		expect(result.path).toBeDefined();
		expect(result.path.endsWith(".html")).toBe(true);
		expect(existsSync(result.path)).toBe(true);
	}, 90000);

	test("should get last assistant text", async () => {
		await client.start();

		// Initially null
		let text = await client.getLastAssistantText();
		expect(text).toBeUndefined();

		// Send prompt
		await client.promptAndWait("Reply with just: test123");

		// Should have text now
		text = await client.getLastAssistantText();
		expect(text).toContain("test123");
	}, 90000);

	test("should get session entries with since cursor", async () => {
		await client.start();

		await client.promptAndWait("Reply with just 'ok'");

		const { entries, leafId } = await client.getEntries();
		expect(entries.length).toBeGreaterThanOrEqual(2); // user + assistant
		for (const entry of entries) {
			expect(entry.id).toBeDefined();
		}
		expect(leafId).toBe(entries[entries.length - 1].id);

		// since cursor returns only entries strictly after the given id
		const since = await client.getEntries(entries[0].id);
		expect(since.entries.map((e) => e.id)).toEqual(entries.slice(1).map((e) => e.id));
		expect(since.leafId).toBe(leafId);

		// unknown since id is an error response
		await expect(client.getEntries("nonexistent-id")).rejects.toThrow("Entry not found");
	}, 90000);

	test("should get session tree", async () => {
		await client.start();

		await client.promptAndWait("Reply with just 'ok'");

		const { entries, leafId } = await client.getEntries();
		const { tree, leafId: treeLeafId } = await client.getTree();
		expect(treeLeafId).toBe(leafId);

		// Single root whose chain matches the entries
		expect(tree.length).toBe(1);
		const chainIds: string[] = [];
		let nodes = tree;
		while (nodes.length === 1) {
			chainIds.push(nodes[0].entry.id);
			nodes = nodes[0].children;
		}
		expect(nodes.length).toBe(0);
		expect(chainIds).toEqual(entries.map((e) => e.id));
	}, 90000);

	test("should retain pre-compaction entries in get_entries", async () => {
		await client.start();

		await client.promptAndWait("Reply with just 'ok'");
		await client.promptAndWait("Reply with just 'ok' again");
		const before = await client.getEntries();

		await client.compact();

		const after = await client.getEntries();
		// Append-only: pre-compaction entries are still there, in the same order
		expect(after.entries.slice(0, before.entries.length).map((e) => e.id)).toEqual(before.entries.map((e) => e.id));
		expect(after.entries.some((e) => e.type === "compaction")).toBe(true);
	}, 120000);

	test("should set and get session name", async () => {
		await client.start();

		// Initially undefined
		let state = await client.getState();
		expect(state.sessionName).toBeUndefined();

		// Send a prompt first - session files are only written after first assistant message
		await client.promptAndWait("Reply with just 'ok'");

		// Set name
		await client.setSessionName("my-test-session");

		// Verify via state
		state = await client.getState();
		expect(state.sessionName).toBe("my-test-session");

		// Wait for file writes
		await new Promise((resolve) => setTimeout(resolve, 200));

		// Verify session_info entry in session file
		const sessionsPath = join(sessionDir, "sessions");
		const sessionDirs = readdirSync(sessionsPath);
		const cwdSessionDir = join(sessionsPath, sessionDirs[0]);
		const sessionFiles = readdirSync(cwdSessionDir).filter((f) => f.endsWith(".jsonl"));
		const sessionContent = readFileSync(join(cwdSessionDir, sessionFiles[0]), "utf8");
		const entries = sessionContent
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		const sessionInfoEntries = entries.filter((e: { type: string }) => e.type === "session_info");
		expect(sessionInfoEntries.length).toBe(1);
		expect(sessionInfoEntries[0].name).toBe("my-test-session");
	}, 60000);
});
