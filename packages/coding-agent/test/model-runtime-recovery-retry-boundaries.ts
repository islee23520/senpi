import { createServer } from "node:http";
import { type Context, type Model, type Provider, streamSimpleOpenAICompletions } from "@earendil-works/pi-ai/compat";
import { expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const leak = '<invoke name="Echo"><parameter name="value">retried</parameter></invoke>';

function selectedModel(baseUrl: string): Model<"openai-completions"> {
	return {
		id: "claude-alias",
		name: "Claude alias",
		api: "openai-completions",
		provider: "retry-boundary",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	};
}

export function registerModelRuntimeRecoveryRetryBoundaryCase(tools: Context["tools"]): void {
	it("keeps an SDK HTTP retry inside one logical recovery wrapper and preserves selected alias activation", async () => {
		let httpRequests = 0;
		let wireModelId = "";
		const server = createServer((request, response) => {
			request.resume();
			httpRequests++;
			if (httpRequests === 1) {
				response.writeHead(500, { "content-type": "application/json" });
				response.end('{"error":{"message":"retry me"}}');
				return;
			}
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				`data: {"id":"chatcmpl-retry","choices":[{"index":0,"delta":{"content":${JSON.stringify(leak)}}}]}\n\n` +
					'data: {"id":"chatcmpl-retry","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
					"data: [DONE]\n\n",
			);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Local retry server did not bind to TCP");
		const selected = selectedModel(`http://127.0.0.1:${address.port}/v1`);
		let providerStreams = 0;
		const provider: Provider = {
			id: selected.provider,
			name: "Retry boundary",
			auth: { apiKey: { name: "test", resolve: async () => ({ auth: { apiKey: "test" }, source: "test" }) } },
			getModels: () => [selected],
			stream: (_model, context, options) => {
				providerStreams++;
				const wireModel = { ...selected, id: "upstream-nonclaude-model" } satisfies Model<"openai-completions">;
				wireModelId = wireModel.id;
				return streamSimpleOpenAICompletions(wireModel, context, options);
			},
			streamSimple: (_model, context, options) => {
				providerStreams++;
				const wireModel = { ...selected, id: "upstream-nonclaude-model" } satisfies Model<"openai-completions">;
				wireModelId = wireModel.id;
				return streamSimpleOpenAICompletions(wireModel, context, options);
			},
		};
		try {
			const runtime = await ModelRuntime.create({
				credentials: AuthStorage.inMemory(),
				modelsPath: null,
				allowModelNetwork: false,
			});
			runtime.registerNativeProvider(provider);
			const model = runtime.getModel(provider.id, selected.id);
			if (!model) throw new Error("Selected alias was not registered");
			const events: string[] = [];
			const stream = runtime.streamSimple(model, { messages: [], tools }, { maxRetries: 1 });
			for await (const event of stream) events.push(event.type);
			const result = await stream.result();
			expect(httpRequests).toBe(2);
			expect(providerStreams).toBe(1);
			expect(events.filter((type) => type === "start")).toHaveLength(1);
			expect(wireModelId).toBe("upstream-nonclaude-model");
			expect(result.content).toContainEqual(
				expect.objectContaining({ type: "toolCall", id: "recovered-antml-0", name: "Echo" }),
			);
		} finally {
			await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
		}
	});
}
