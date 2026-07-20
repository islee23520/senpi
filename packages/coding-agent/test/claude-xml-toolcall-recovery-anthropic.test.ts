import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { createAgentSession } from "../src/core/sdk.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";

const RETRY_GUIDANCE = "Re-issue the tool call with complete arguments.";

type CapturedRequest = {
	headers: IncomingHttpHeaders;
	body: Record<string, unknown>;
};

type Scenario = "complete" | "truncated";

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(message)), 2_000);
		}),
	]);
}

function writeSse(response: ServerResponse, event: string, payload: unknown): void {
	response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function writeMessageStart(response: ServerResponse, id: string): void {
	writeSse(response, "message_start", {
		type: "message_start",
		message: {
			id,
			usage: {
				input_tokens: 4,
				output_tokens: 0,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		},
	});
	writeSse(response, "content_block_start", {
		type: "content_block_start",
		index: 0,
		content_block: { type: "text", text: "" },
	});
}

function finishMessage(response: ServerResponse, text: string, id: string): void {
	writeMessageStart(response, id);
	writeSse(response, "content_block_delta", {
		type: "content_block_delta",
		index: 0,
		delta: { type: "text_delta", text },
	});
	writeSse(response, "content_block_stop", { type: "content_block_stop", index: 0 });
	writeSse(response, "message_delta", {
		type: "message_delta",
		delta: { stop_reason: "end_turn" },
		usage: {
			input_tokens: 8,
			output_tokens: 3,
			cache_read_input_tokens: 0,
			cache_creation_input_tokens: 0,
		},
	});
	writeSse(response, "message_stop", { type: "message_stop" });
	response.end();
}

async function readRequestBody(request: AsyncIterable<Uint8Array>): Promise<Record<string, unknown>> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of request) chunks.push(chunk);
	return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

async function startAnthropicServer(scenario: Scenario) {
	const requests: CapturedRequest[] = [];
	const openingWritten = deferred();
	const toolcallStarted = deferred();
	const closeWritten = deferred();
	let requestNumber = 0;

	const server = createServer(async (request, response) => {
		if (request.method !== "POST" || request.url !== "/v1/messages") {
			response.writeHead(404).end();
			return;
		}
		requests.push({ headers: request.headers, body: await readRequestBody(request) });
		requestNumber++;
		response.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
		});
		response.flushHeaders();

		if (requestNumber === 2) {
			finishMessage(response, scenario === "complete" ? "complete final" : "corrective final", "msg_final");
			return;
		}

		writeMessageStart(response, "msg_leak");
		writeSse(response, "content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: 'I will check. <antml:invoke name="Echo">' },
		});
		openingWritten.resolve();
		try {
			await withTimeout(toolcallStarted.promise, "toolcall_start was not observed after the invoke opening");
		} catch (error) {
			response.destroy(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		writeSse(response, "content_block_delta", {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: '<antml:parameter name="value">hello</antml:parameter>' },
		});
		if (scenario === "complete") {
			writeSse(response, "content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: "</antml:invoke>" },
			});
		}
		closeWritten.resolve();
		writeSse(response, "content_block_stop", { type: "content_block_stop", index: 0 });
		writeSse(response, "message_delta", {
			type: "message_delta",
			delta: { stop_reason: "end_turn" },
			usage: {
				input_tokens: 4,
				output_tokens: 8,
				cache_read_input_tokens: 0,
				cache_creation_input_tokens: 0,
			},
		});
		writeSse(response, "message_stop", { type: "message_stop" });
		response.end();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("Expected TCP server address");
	return {
		baseUrl: `http://127.0.0.1:${address.port}`,
		requests,
		openingWritten,
		toolcallStarted,
		closeWritten,
		server,
	};
}

async function closeServer(server: Server): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

function contentBlocks(request: CapturedRequest, role: "assistant" | "user"): Array<Record<string, unknown>> {
	const messages = request.body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
	return messages.filter((message) => message.role === role).flatMap((message) => message.content);
}

async function runScenario(scenario: Scenario) {
	const endpoint = await startAnthropicServer(scenario);
	let executeCount = 0;
	const runtime = await ModelRuntime.create({
		credentials: AuthStorage.inMemory(),
		modelsPath: null,
		allowModelNetwork: false,
	});
	await runtime.registerProvider("anthropic-recovery-wire", {
		name: "Anthropic recovery wire",
		api: "anthropic-messages",
		apiKey: "mock-anthropic-key",
		baseUrl: endpoint.baseUrl,
		models: [
			{
				id: "claude-recovery-model",
				name: "Claude recovery model",
				reasoning: false,
				recoverTextToolCalls: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 10_000,
				maxTokens: 1_000,
			},
		],
	});
	const model = runtime.getModel("anthropic-recovery-wire", "claude-recovery-model");
	if (!model) throw new Error("Expected registered Anthropic model");
	const sessionManager = SessionManager.inMemory();
	const { session } = await createAgentSession({
		modelRuntime: runtime,
		model,
		cwd: process.cwd(),
		settingsManager: SettingsManager.inMemory(),
		sessionManager,
		tools: ["Echo"],
		customTools: [
			{
				name: "Echo",
				label: "Echo",
				description: "Echo a value",
				parameters: Type.Object({ value: Type.String() }),
				execute: async () => {
					executeCount++;
					return { content: [{ type: "text", text: "echo:hello" }], details: {} };
				},
			},
		],
	});
	const eventOrder: string[] = [];
	const unsubscribe = session.subscribe((event) => {
		if (event.type !== "message_update") return;
		eventOrder.push(event.assistantMessageEvent.type);
		if (event.assistantMessageEvent.type === "toolcall_start") endpoint.toolcallStarted.resolve();
	});
	try {
		await session.prompt("Use Echo once.");
		await withTimeout(endpoint.openingWritten.promise, "invoke opening was not written");
		await withTimeout(endpoint.closeWritten.promise, "invoke close was not written");
		return { endpoint, session, executeCount, eventOrder };
	} catch (error) {
		await closeServer(endpoint.server);
		session.dispose();
		throw error;
	} finally {
		unsubscribe();
	}
}

const servers: Server[] = [];
afterEach(async () => {
	await Promise.all(servers.splice(0).map(closeServer));
});

describe("Claude XML tool-call recovery through Anthropic wire format", () => {
	it("executes a complete leaked invoke through raw Anthropic SSE and replays tool_use", async () => {
		const result = await runScenario("complete");
		servers.push(result.endpoint.server);
		expect(result.executeCount).toBe(1);
		expect(result.endpoint.requests).toHaveLength(2);
		expect(result.endpoint.requests[0]?.headers["x-api-key"]).toBe("mock-anthropic-key");
		const assistantBlocks = contentBlocks(result.endpoint.requests[1]!, "assistant");
		const userBlocks = contentBlocks(result.endpoint.requests[1]!, "user");
		expect(assistantBlocks).toContainEqual(
			expect.objectContaining({ type: "tool_use", name: "Echo", input: { value: "hello" } }),
		);
		expect(userBlocks).toContainEqual(expect.objectContaining({ type: "tool_result", is_error: false }));
		expect(JSON.stringify(result.endpoint.requests[1]!.body)).not.toMatch(/<\/?(?:antml:)?invoke/u);
		expect(result.eventOrder.indexOf("toolcall_start")).toBeLessThan(result.eventOrder.indexOf("toolcall_end"));
		expect(result.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ text: "complete final" }],
		});
		result.session.dispose();
	});

	it("safe-fails a truncated leaked invoke through raw Anthropic SSE and replays an error tool_result", async () => {
		const result = await runScenario("truncated");
		servers.push(result.endpoint.server);
		expect(result.executeCount).toBe(0);
		expect(result.endpoint.requests).toHaveLength(2);
		const assistant = result.session.messages.find(
			(message) => message.role === "assistant" && message.content.some((block) => block.type === "toolCall"),
		);
		expect(assistant).toBeDefined();
		if (assistant?.role !== "assistant") throw new Error("Expected recovered assistant message");
		expect(assistant.content).toContainEqual(expect.objectContaining({ type: "toolCall", incomplete: true }));
		const assistantBlocks = contentBlocks(result.endpoint.requests[1]!, "assistant");
		const userBlocks = contentBlocks(result.endpoint.requests[1]!, "user");
		expect(assistantBlocks).toContainEqual(expect.objectContaining({ type: "tool_use", name: "Echo" }));
		expect(userBlocks).toContainEqual(
			expect.objectContaining({
				type: "tool_result",
				is_error: true,
				content: expect.stringContaining(RETRY_GUIDANCE),
			}),
		);
		expect(JSON.stringify(result.endpoint.requests[1]!.body)).not.toMatch(/<\/?(?:antml:)?invoke/u);
		expect(result.session.messages.at(-1)).toMatchObject({
			role: "assistant",
			content: [{ text: "corrective final" }],
		});
		result.session.dispose();
	});
});
