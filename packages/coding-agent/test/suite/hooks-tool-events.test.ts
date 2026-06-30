import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { parseHookConfig } from "../../src/core/extensions/builtin/hooks/index.ts";
import { createHookTrustEntry, hookTrustId } from "../../src/core/extensions/builtin/hooks/trust.ts";
import type {
	HookSourceMetadata,
	HookTrustEntry,
	SupportedHookEvent,
} from "../../src/core/extensions/builtin/hooks/types.ts";
import { builtinExtensions } from "../../src/core/extensions/builtin/index.ts";
import type { ExtensionFactory } from "../../src/index.ts";
import { createHarness, getAssistantTexts, type Harness } from "./harness.ts";

const createdDirs: string[] = [];
type ToolResultMessage = Extract<AgentMessage, { role: "toolResult" }>;

function hooksExtensionFactory() {
	const extension = builtinExtensions.find((entry) => entry.id === "hooks");
	if (extension === undefined) {
		throw new Error("builtin hooks extension is not registered");
	}
	return extension.factory;
}

function createTempDir(prefix: string): string {
	const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	createdDirs.push(dir);
	return dir;
}

function createEchoTool(seenInputs: string[]): AgentTool {
	return {
		name: "echo",
		label: "Echo",
		description: "Echo text back",
		parameters: Type.Object({ text: Type.String() }),
		execute: async (_toolCallId, params) => {
			const text = typeof params === "object" && params !== null && "text" in params ? String(params.text) : "";
			seenInputs.push(text);
			return { content: [{ type: "text", text: `tool:${text}` }], details: { text } };
		},
	};
}

function findToolResult(messages: readonly AgentMessage[]): ToolResultMessage | undefined {
	const message = messages.find((item) => item.role === "toolResult");
	return message?.role === "toolResult" ? message : undefined;
}

function findLatestToolResult(messages: readonly AgentMessage[]): ToolResultMessage | undefined {
	return messages.findLast((item): item is ToolResultMessage => item.role === "toolResult");
}

function toolResultText(message: ToolResultMessage | undefined): string {
	if (message === undefined) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function writeHookProject(
	cwd: string,
	event: SupportedHookEvent,
	commandOrCommands: string | readonly string[],
	matcher = "echo",
): void {
	const senpiDir = join(cwd, ".senpi");
	mkdirSync(senpiDir, { recursive: true });
	const sourcePath = join(senpiDir, "hooks.json");
	const commands = typeof commandOrCommands === "string" ? [commandOrCommands] : commandOrCommands;
	const hookConfig = {
		hooks: {
			[event]: [
				{
					matcher,
					hooks: commands.map((command) => ({
						type: "command",
						command,
					})),
				},
			],
		},
	};
	writeFileSync(sourcePath, `${JSON.stringify(hookConfig, null, 2)}\n`, "utf-8");

	const source = {
		discoveredAt: "pre-session",
		displayOrder: 0,
		scope: "project",
		sourcePath,
	} satisfies HookSourceMetadata;
	const parsed = parseHookConfig(hookConfig, source);
	const hooks: Record<string, HookTrustEntry> = {};
	for (const handler of parsed.executableHandlers) {
		hooks[hookTrustId(handler)] = createHookTrustEntry(handler, {
			platform: process.platform,
			updatedAt: "2026-06-29T00:00:00.000Z",
		});
	}
	writeFileSync(join(senpiDir, "hooks-state.json"), `${JSON.stringify({ version: 1, hooks }, null, 2)}\n`, "utf-8");
}

async function createHooksHarness(
	seenInputs: string[] = [],
	extensionFactories: readonly ExtensionFactory[] = [],
): Promise<Harness> {
	return createHarness({
		tools: [createEchoTool(seenInputs)],
		extensionFactories: [{ factory: hooksExtensionFactory(), path: "<builtin:hooks>" }, ...extensionFactories],
	});
}

afterEach(() => {
	for (const dir of createdDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("builtin hooks tool event adapters", () => {
	it("blocks PreToolUse deny before execution and sends Claude/Codex tool stdin fields", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-pre-tool-deny-hook");
		const stdinPath = join(hookDir, "stdin.json");
		const scriptPath = join(hookDir, "deny.mjs");
		writeFileSync(
			scriptPath,
			`import { writeFileSync } from 'node:fs'; let stdin = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { stdin += chunk; }); process.stdin.on('end', () => { writeFileSync(${JSON.stringify(stdinPath)}, stdin); process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'destructive command denied' } })); });`,
			"utf-8",
		);
		const harness = await createHooksHarness(seenInputs);
		writeHookProject(harness.tempDir, "PreToolUse", `${process.execPath} ${scriptPath}`);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "delete everything" }, { id: "tool-deny" })], {
				stopReason: "toolUse",
			}),
			(context) => {
				return fauxAssistantMessage(toolResultText(findToolResult(context.messages)));
			},
		]);

		try {
			// When
			await harness.session.prompt("run tool");

			// Then
			expect(seenInputs).toEqual([]);
			expect(getAssistantTexts(harness)).toContain("destructive command denied");
			const stdin: unknown = JSON.parse(readFileSync(stdinPath, "utf-8"));
			expect(stdin).toMatchObject({
				session_id: harness.session.sessionId,
				cwd: harness.tempDir,
				hook_event_name: "PreToolUse",
				tool_name: "echo",
				tool_input: { text: "delete everything" },
				tool_use_id: "tool-deny",
			});
			expect(stdin).not.toHaveProperty("tool_response");
		} finally {
			harness.cleanup();
		}
	});

	it("applies PreToolUse allow updatedInput and exposes additionalContext to the active turn", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-pre-tool-allow-hook");
		const scriptPath = join(hookDir, "allow.mjs");
		writeFileSync(
			scriptPath,
			"process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { text: 'patched input' }, additionalContext: 'Pre hook saw and approved the patched input.' } })); });",
			"utf-8",
		);
		const harness = await createHooksHarness(seenInputs);
		writeHookProject(harness.tempDir, "PreToolUse", `${process.execPath} ${scriptPath}`);
		let sawPreContext = false;
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "original input" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = findToolResult(context.messages);
				sawPreContext =
					toolResult?.content.some(
						(part) => part.type === "text" && part.text.includes("Pre hook saw and approved"),
					) === true;
				return fauxAssistantMessage(toolResultText(toolResult));
			},
		]);

		try {
			// When
			await harness.session.prompt("run tool");

			// Then
			expect(seenInputs).toEqual(["patched input"]);
			expect(getAssistantTexts(harness).join("\n")).toContain("tool:patched input");
			expect(sawPreContext).toBe(true);
		} finally {
			harness.cleanup();
		}
	});

	it("applies PostToolUse updatedToolOutput with additionalContext as model-visible result content", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-post-tool-hook");
		const stdinPath = join(hookDir, "stdin.json");
		const scriptPath = join(hookDir, "post.mjs");
		writeFileSync(
			scriptPath,
			`import { writeFileSync } from 'node:fs'; let stdin = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { stdin += chunk; }); process.stdin.on('end', () => { writeFileSync(${JSON.stringify(stdinPath)}, stdin); process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'redacted replacement', additionalContext: 'Post hook context for the model.' } })); });`,
			"utf-8",
		);
		const harness = await createHooksHarness(seenInputs);
		writeHookProject(harness.tempDir, "PostToolUse", `${process.execPath} ${scriptPath}`);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "secret output" }, { id: "tool-post" })], {
				stopReason: "toolUse",
			}),
			(context) => {
				return fauxAssistantMessage(toolResultText(findToolResult(context.messages)));
			},
		]);

		try {
			// When
			await harness.session.prompt("run tool");

			// Then
			expect(seenInputs).toEqual(["secret output"]);
			const assistantText = getAssistantTexts(harness).join("\n");
			expect(assistantText).toContain("redacted replacement");
			expect(assistantText).toContain("Post hook context for the model.");
			expect(assistantText).not.toContain("tool:secret output");
			const stdin: unknown = JSON.parse(readFileSync(stdinPath, "utf-8"));
			expect(stdin).toMatchObject({
				session_id: harness.session.sessionId,
				cwd: harness.tempDir,
				hook_event_name: "PostToolUse",
				tool_name: "echo",
				tool_input: { text: "secret output" },
				tool_response: {
					content: [{ type: "text", text: "tool:secret output" }],
					details: { text: "secret output" },
				},
				tool_use_id: "tool-post",
			});
		} finally {
			harness.cleanup();
		}
	});

	it("preserves earlier PostToolUse additionalContext when a later hook replaces tool output", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-post-tool-multi-hook");
		const contextScriptPath = join(hookDir, "context.mjs");
		const replacementScriptPath = join(hookDir, "replacement.mjs");
		writeFileSync(
			contextScriptPath,
			"process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'Earlier post hook context.' } })); });",
			"utf-8",
		);
		writeFileSync(
			replacementScriptPath,
			"process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: 'later replacement' } })); });",
			"utf-8",
		);
		const harness = await createHooksHarness(seenInputs);
		writeHookProject(harness.tempDir, "PostToolUse", [
			`${process.execPath} ${contextScriptPath}`,
			`${process.execPath} ${replacementScriptPath}`,
		]);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "secret output" }, { id: "tool-post-multi" })], {
				stopReason: "toolUse",
			}),
			(context) => fauxAssistantMessage(toolResultText(findToolResult(context.messages))),
		]);

		try {
			// When
			await harness.session.prompt("run tool");

			// Then
			expect(seenInputs).toEqual(["secret output"]);
			const assistantText = getAssistantTexts(harness).join("\n");
			expect(assistantText).toContain("later replacement");
			expect(assistantText).toContain("Earlier post hook context.");
			expect(assistantText).not.toContain("tool:secret output");
		} finally {
			harness.cleanup();
		}
	});

	it("does not reuse PreToolUse additionalContext after a later tool_call handler blocks the same id", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-pre-tool-stale-context");
		const scriptPath = join(hookDir, "allow-context.mjs");
		writeFileSync(
			scriptPath,
			"let stdin = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (chunk) => { stdin += chunk; }); process.stdin.on('end', () => { const input = JSON.parse(stdin); const text = input.tool_input?.text; const output = text === 'blocked first' ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: 'Context from blocked first call.' } } : { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }; process.stdout.write(JSON.stringify(output)); });",
			"utf-8",
		);
		const laterBlocker: ExtensionFactory = (pi) => {
			pi.on("tool_call", async (event) => {
				if (event.toolName === "echo" && event.input.text === "blocked first") {
					return { block: true, reason: "Blocked after builtin hooks queued context." };
				}
				return undefined;
			});
		};
		const harness = await createHooksHarness(seenInputs, [laterBlocker]);
		writeHookProject(harness.tempDir, "PreToolUse", `${process.execPath} ${scriptPath}`);
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "blocked first" }, { id: "reused-pre-id" })], {
				stopReason: "toolUse",
			}),
			(context) => fauxAssistantMessage(toolResultText(findLatestToolResult(context.messages))),
			fauxAssistantMessage([fauxToolCall("echo", { text: "later input" }, { id: "reused-pre-id" })], {
				stopReason: "toolUse",
			}),
			(context) => fauxAssistantMessage(toolResultText(findLatestToolResult(context.messages))),
		]);

		try {
			// When
			await harness.session.prompt("run blocked tool");
			await harness.session.prompt("run later tool");

			// Then
			expect(seenInputs).toEqual(["later input"]);
			const assistantText = getAssistantTexts(harness).join("\n");
			expect(assistantText).toContain("Blocked after builtin hooks queued context.");
			expect(assistantText).toContain("tool:later input");
			expect(assistantText).not.toContain("Context from blocked first call.");
		} finally {
			harness.cleanup();
		}
	});

	it("represents PostToolUse block decisions as model-visible error context after execution", async () => {
		// Given
		const seenInputs: string[] = [];
		const hookDir = createTempDir("senpi-post-tool-block-hook");
		const scriptPath = join(hookDir, "block.mjs");
		writeFileSync(
			scriptPath,
			"process.stdin.resume(); process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ decision: 'block', reason: 'Post hook flagged the already executed result.' })); });",
			"utf-8",
		);
		const harness = await createHooksHarness(seenInputs);
		writeHookProject(harness.tempDir, "PostToolUse", `${process.execPath} ${scriptPath}`);
		let sawErrorResult = false;
		harness.setResponses([
			fauxAssistantMessage([fauxToolCall("echo", { text: "unsafe output" })], { stopReason: "toolUse" }),
			(context) => {
				const toolResult = findToolResult(context.messages);
				sawErrorResult = toolResult?.isError === true;
				return fauxAssistantMessage(toolResultText(toolResult));
			},
		]);

		try {
			// When
			await harness.session.prompt("run tool");

			// Then
			expect(seenInputs).toEqual(["unsafe output"]);
			const assistantText = getAssistantTexts(harness).join("\n");
			expect(assistantText).toContain("Post hook flagged the already executed result.");
			expect(assistantText).not.toContain("tool:unsafe output");
			expect(sawErrorResult).toBe(true);
		} finally {
			harness.cleanup();
		}
	});
});
