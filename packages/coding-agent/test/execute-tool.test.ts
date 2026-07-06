import { writeFileSync } from "node:fs";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it, vi } from "vitest";
import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext, ExtensionFactory } from "../src/index.ts";
import { createHarness } from "./suite/harness.ts";

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function createExecuteToolHarness(factory: (pi: ExtensionAPI) => void) {
	let api: ExtensionAPI | undefined;
	const extensionFactories: ExtensionFactory[] = [
		(pi) => {
			api = pi;
			factory(pi);
		},
	];
	return createHarness({ extensionFactories }).then((harness) => ({
		...harness,
		api: api as ExtensionAPI,
	}));
}

describe("pi.executeTool", () => {
	it("dispatches extension tools through tool_call and tool_result hooks", async () => {
		const calls: Array<{ toolName: string; input: Record<string, unknown> }> = [];
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "echo_ext",
				label: "Echo",
				description: "Echo extension input",
				parameters: Type.Object({ value: Type.String() }),
				execute: async (_toolCallId, params) => ({
					content: [{ type: "text", text: `value:${params.value}` }],
					details: { value: params.value },
				}),
			});
			pi.on("tool_call", (event) => {
				calls.push({ toolName: event.toolName, input: { ...event.input } });
				const input = event.input as Record<string, unknown>;
				input.value = `${input.value}-mutated`;
				return undefined;
			});
			pi.on("tool_result", (event) => ({
				content: [
					{ type: "text", text: `${event.content[0]?.type === "text" ? event.content[0].text : ""}:rewritten` },
				],
				details: { ...(typeof event.details === "object" && event.details ? event.details : {}), rewritten: true },
			}));
		});

		try {
			const result = await harness.api.executeTool("echo_ext", { value: "start" });

			expect(calls).toEqual([{ toolName: "echo_ext", input: { value: "start" } }]);
			expect(textOf(result)).toBe("value:start-mutated:rewritten");
			expect(result.details).toEqual({ value: "start-mutated", rewritten: true });
		} finally {
			harness.cleanup();
		}
	});

	it("dispatches built-in tools from the active set", async () => {
		const harness = await createExecuteToolHarness(() => {});
		try {
			const path = `${harness.tempDir}/present.txt`;
			writeFileSync(path, "built-in dispatch");
			const result = await harness.api.executeTool("read", { path });

			expect(textOf(result)).toContain("built-in dispatch");
		} finally {
			harness.cleanup();
		}
	});

	it("blocks before execution with the exact hook reason", async () => {
		const execute = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "should-not-run" }],
			details: {},
		}));
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "blocked_ext",
				label: "Blocked",
				description: "Blocked extension tool",
				parameters: Type.Object({}),
				execute,
			});
			pi.on("tool_call", () => ({ block: true, reason: "nope" }));
		});

		try {
			await expect(harness.api.executeTool("blocked_ext", {})).rejects.toMatchObject({
				code: "blocked",
				message: "nope",
			});
			expect(execute).not.toHaveBeenCalled();
		} finally {
			harness.cleanup();
		}
	});

	it("applies tool_result rewrites after execution", async () => {
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "rewrite_ext",
				label: "Rewrite",
				description: "Rewrite result",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: "original" }],
					details: { original: true },
				}),
			});
			pi.on("tool_result", () => ({
				content: [{ type: "text", text: "replacement" }],
				details: { replacement: true },
				isError: true,
			}));
		});

		try {
			const result = await harness.api.executeTool("rewrite_ext", {});

			expect(textOf(result)).toBe("replacement");
			expect(result.details).toEqual({ replacement: true });
		} finally {
			harness.cleanup();
		}
	});

	it("rejects unknown and inactive tools with typed errors", async () => {
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "inactive_ext",
				label: "Inactive",
				description: "Inactive extension tool",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: "inactive" }],
					details: {},
				}),
			});
		});

		try {
			harness.session.setActiveToolsByName(["read"]);
			await expect(harness.api.executeTool("missing_ext", {})).rejects.toMatchObject({
				code: "unknown_tool",
				activeTools: ["read"],
			});
			await expect(harness.api.executeTool("inactive_ext", {})).rejects.toMatchObject({
				code: "inactive_tool",
				toolName: "inactive_ext",
				activeTools: ["read"],
			});
		} finally {
			harness.cleanup();
		}
	});

	it("forwards AbortSignal and onUpdate to tool execution", async () => {
		let observedSignal: AbortSignal | undefined;
		let observedOnUpdate: AgentToolUpdateCallback | undefined;
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "stream_ext",
				label: "Stream",
				description: "Streams updates",
				parameters: Type.Object({}),
				execute: async (_toolCallId, _params, signal, onUpdate) => {
					observedSignal = signal;
					observedOnUpdate = onUpdate;
					onUpdate?.({ content: [{ type: "text", text: "partial" }], details: { step: 1 } });
					return { content: [{ type: "text", text: "done" }], details: {} };
				},
			});
		});

		try {
			const controller = new AbortController();
			const updates: unknown[] = [];
			await harness.api.executeTool(
				"stream_ext",
				{},
				{
					signal: controller.signal,
					onUpdate: (update: unknown) => updates.push(update),
				},
			);

			expect(observedSignal).toBe(controller.signal);
			expect(observedOnUpdate).toBeTypeOf("function");
			expect(updates).toEqual([{ content: [{ type: "text", text: "partial" }], details: { step: 1 } }]);
		} finally {
			harness.cleanup();
		}
	});

	it("rejects invalid params before hooks and execution", async () => {
		const execute = vi.fn(async () => ({
			content: [{ type: "text" as const, text: "invalid" }],
			details: {},
		}));
		const hook = vi.fn();
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "validated_ext",
				label: "Validated",
				description: "Validated extension tool",
				parameters: Type.Object({ required: Type.String() }),
				execute,
			});
			pi.on("tool_call", hook);
		});

		try {
			await expect(harness.api.executeTool("validated_ext", {})).rejects.toMatchObject({
				code: "invalid_params",
			});
			expect(execute).not.toHaveBeenCalled();
			expect(hook).not.toHaveBeenCalled();
		} finally {
			harness.cleanup();
		}
	});

	it("uses the same extension context shape as agent-loop dispatch", async () => {
		const observations: unknown[] = [];
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "ctx_ext",
				label: "Context",
				description: "Echo context",
				parameters: Type.Object({ source: Type.String() }),
				execute: async (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) => {
					const observation = {
						source: params.source,
						cwd: ctx.cwd,
						hasModel: Boolean(ctx.model),
						hasSessionManager: Boolean(ctx.sessionManager),
					};
					observations.push(observation);
					return {
						content: [{ type: "text", text: JSON.stringify(observation) }],
						details: observation,
					};
				},
			});
		});

		try {
			harness.session.setActiveToolsByName(["ctx_ext"]);
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("ctx_ext", { source: "agent" }), { stopReason: "toolUse" }),
				fauxAssistantMessage("done"),
			]);

			await harness.session.prompt("run");
			const bridgeResult = await harness.api.executeTool("ctx_ext", { source: "bridge" });

			expect(observations).toHaveLength(2);
			expect(observations[0]).toMatchObject({ cwd: harness.tempDir, hasModel: true, hasSessionManager: true });
			expect(bridgeResult.details).toMatchObject({ cwd: harness.tempDir, hasModel: true, hasSessionManager: true });
		} finally {
			harness.cleanup();
		}
	});

	it("normalizes non-Error tool_call hook failures after queued events settle", async () => {
		const order: string[] = [];
		let releaseMessageUpdate: (() => void) | undefined;
		const messageUpdateEntered = new Promise<void>((resolve) => {
			releaseMessageUpdate = resolve;
		});
		let unblockMessageUpdate: (() => void) | undefined;
		const messageUpdateBlocked = new Promise<void>((resolve) => {
			unblockMessageUpdate = resolve;
		});
		const harness = await createExecuteToolHarness((pi) => {
			pi.registerTool({
				name: "order_ext",
				label: "Order",
				description: "Order extension tool",
				parameters: Type.Object({}),
				execute: async () => ({
					content: [{ type: "text", text: "order" }],
					details: {},
				}),
			});
			pi.on("message_update", async () => {
				releaseMessageUpdate?.();
				await messageUpdateBlocked;
				order.push("message_update");
			});
			pi.on("tool_call", () => {
				order.push("tool_call");
				throw "boom";
			});
		});

		try {
			harness.setResponses([fauxAssistantMessage("queued")]);
			const promptPromise = harness.session.prompt("queue an update");
			await messageUpdateEntered;
			const executePromise = harness.api.executeTool("order_ext", {});
			await Promise.resolve();
			expect(order).toEqual([]);
			unblockMessageUpdate?.();
			await promptPromise;

			await expect(executePromise).rejects.toMatchObject({
				message: "Extension failed, blocking execution: boom",
			});
			expect(order.slice(0, 2)).toEqual(["message_update", "tool_call"]);
		} finally {
			harness.cleanup();
		}
	});
});
