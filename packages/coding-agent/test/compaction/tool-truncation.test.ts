import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, TextContent, ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
	prePruneToolOutputsToBudget,
	truncateOversizedToolResults,
} from "../../src/core/extensions/builtin/compaction/tool-truncation.ts";
import {
	type FileEntry,
	migrateSessionEntries,
	parseSessionEntries,
	type SessionMessageEntry,
} from "../../src/core/session-manager.ts";

const TRUNCATION_MARKER_RE = /<truncated:\d+ bytes original[^>]*>/;

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

function buildTruncationMarker(originalBytes: number): string {
	return `<truncated:${originalBytes} bytes original; middle elided to save context - re-run this tool with a narrower range (read offset/limit or a filtered command) to retrieve the elided content>`;
}

function buildLegacyTruncationMarker(originalBytes: number): string {
	return `<truncated:${originalBytes} bytes original>`;
}

function utf8ByteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function loadToolResultMessages(relativePath: string): ToolResultMessage[] {
	const fixturePath = join(TEST_DIR, "../fixtures/compaction", relativePath);
	const content = readFileSync(fixturePath, "utf-8");
	const fileEntries: FileEntry[] = parseSessionEntries(content);
	migrateSessionEntries(fileEntries);
	const results: ToolResultMessage[] = [];
	for (const entry of fileEntries) {
		if (entry.type !== "message") continue;
		const messageEntry = entry as SessionMessageEntry;
		const message = messageEntry.message as Message;
		if (message.role !== "toolResult") continue;
		results.push({ ...message, isError: message.isError ?? false });
	}
	return results;
}

function toolResultMessagesToAgentToolResults(messages: ToolResultMessage[]): AgentToolResult<unknown>[] {
	return messages.map((message) => ({
		content: message.content,
		details: undefined,
	}));
}

function buildOversizedResult(byteLength: number): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: "X".repeat(byteLength) }],
		details: undefined,
	};
}

function totalTextBytes(result: AgentToolResult<unknown>): number {
	let total = 0;
	for (const block of result.content) {
		if (block.type === "text") {
			total += utf8ByteLength(block.text);
		}
	}
	return total;
}

function firstTextBlock(result: AgentToolResult<unknown>): TextContent | undefined {
	for (const block of result.content) {
		if (block.type === "text") return block;
	}
	return undefined;
}

function countMarkerOccurrences(result: AgentToolResult<unknown>): number {
	let count = 0;
	for (const block of result.content) {
		if (block.type !== "text") continue;
		const matches = block.text.match(new RegExp(TRUNCATION_MARKER_RE.source, "g"));
		if (matches) count += matches.length;
	}
	return count;
}

function expectActionableMarker(text: string, originalBytes: number): string {
	const marker = text.match(TRUNCATION_MARKER_RE)?.[0] ?? "";
	expect(marker).toBeTruthy();
	expect(marker).toMatch(TRUNCATION_MARKER_RE);
	expect(marker.startsWith(`<truncated:${originalBytes} bytes original`)).toBe(true);
	expect(marker).toContain("re-run this tool");
	expect(marker.endsWith(">")).toBe(true);
	return marker;
}

describe("compaction tool truncation behavior", () => {
	describe("Given context at 95% with one 50KB bash output", () => {
		describe("When tool-truncation runs at 90% ceiling", () => {
			it("Then output truncated and actionable marker inserted", () => {
				const fixtureResults = loadToolResultMessages("tool-truncation/large-bash-output.jsonl");
				const fiftyKb = 50 * 1024;
				const oversized = buildOversizedResult(fiftyKb);
				const inputs: AgentToolResult<unknown>[] = [
					...toolResultMessagesToAgentToolResults(fixtureResults),
					oversized,
				];

				const truncated = truncateOversizedToolResults(inputs);

				expect(truncated.length).toBe(inputs.length);
				const last = truncated[truncated.length - 1];
				expect(last, "oversized result must remain in array after truncation").toBeDefined();
				const truncatedText = firstTextBlock(last as AgentToolResult<unknown>)?.text ?? "";
				expectActionableMarker(truncatedText, fiftyKb);
				expect(totalTextBytes(last as AgentToolResult<unknown>)).toBeLessThan(fiftyKb);
			});
		});
	});

	describe("Given last K tool results within retention window", () => {
		describe("When truncation runs", () => {
			it("Then last K preserved in full", () => {
				const retainK = 2;
				const oldOversized: AgentToolResult<unknown>[] = [
					buildOversizedResult(40 * 1024),
					buildOversizedResult(40 * 1024),
				];
				const recent: AgentToolResult<unknown>[] = [
					{ content: [{ type: "text", text: "recent-output-A" }], details: undefined },
					{ content: [{ type: "text", text: "recent-output-B" }], details: undefined },
				];
				const inputs = [...oldOversized, ...recent];

				const truncated = truncateOversizedToolResults(inputs);

				expect(truncated.length).toBe(inputs.length);
				const tail = truncated.slice(-retainK);
				expect(tail.length).toBe(retainK);
				expect(tail[0]).toEqual(recent[0]);
				expect(tail[1]).toEqual(recent[1]);
			});
		});
	});

	describe("Given truncated content", () => {
		describe("When truncation re-runs idempotently", () => {
			it("Then no double-marker", () => {
				const oversized = buildOversizedResult(60 * 1024);
				const firstPass = truncateOversizedToolResults([oversized]);
				const firstResult = firstPass[0];
				expect(firstResult, "first pass must produce a truncated result").toBeDefined();

				const secondPass = truncateOversizedToolResults([firstResult as AgentToolResult<unknown>]);
				const secondResult = secondPass[0];
				expect(secondResult, "second pass must keep the truncated result").toBeDefined();
				expect(countMarkerOccurrences(secondResult as AgentToolResult<unknown>)).toBe(1);
			});
		});
	});

	describe("Given truncation marker present", () => {
		describe("When pre-prune sees it", () => {
			it("Then marker preserved with guidance in the parseable wire format", () => {
				const originalBytes = 80 * 1024;
				const marker = buildTruncationMarker(originalBytes);
				const markedResult: AgentToolResult<unknown> = {
					content: [{ type: "text", text: `Beginning of output... ${marker}` }],
					details: undefined,
				};
				const inputs = [markedResult];
				const generousBudget = 1_000_000;

				const pruned = prePruneToolOutputsToBudget(inputs, generousBudget);
				const result = pruned[0];

				expect(result, "pre-prune must keep the marked result intact when budget allows").toBeDefined();
				const text = firstTextBlock(result as AgentToolResult<unknown>)?.text ?? "";
				expect(text).toContain(marker);
				expectActionableMarker(text, originalBytes);
			});
		});
	});

	describe("Given legacy truncation marker present", () => {
		describe("When truncation runs idempotently", () => {
			it("Then legacy marker is not double-truncated", () => {
				const marker = buildLegacyTruncationMarker(123);
				const markedResult: AgentToolResult<unknown> = {
					content: [{ type: "text", text: `${"A".repeat(60 * 1024)}\n${marker}\n${"B".repeat(60 * 1024)}` }],
					details: undefined,
				};

				const truncated = truncateOversizedToolResults([markedResult]);
				const result = truncated[0];

				expect(result, "legacy marked result must remain present").toBeDefined();
				expect(result).toEqual(markedResult);
				expect(countMarkerOccurrences(result as AgentToolResult<unknown>)).toBe(1);
			});
		});

		describe("When pre-prune must reduce marked content", () => {
			it("Then legacy marker is reduced to exactly the marker", () => {
				const marker = buildLegacyTruncationMarker(123);
				const markedResult: AgentToolResult<unknown> = {
					content: [{ type: "text", text: `${"A".repeat(60 * 1024)}\n${marker}\n${"B".repeat(60 * 1024)}` }],
					details: undefined,
				};

				const pruned = prePruneToolOutputsToBudget([markedResult], 1);
				const result = pruned[0];

				expect(result, "pre-prune must keep the legacy marked result").toBeDefined();
				const text = firstTextBlock(result as AgentToolResult<unknown>)?.text ?? "";
				expect(text).toBe(marker);
			});
		});
	});

	describe("Given new truncation marker present", () => {
		describe("When pre-prune needs a second pass", () => {
			it("Then the entire actionable marker is preserved", () => {
				const originalBytes = 60 * 1024;
				const oversized = buildOversizedResult(originalBytes);

				const pruned = prePruneToolOutputsToBudget([oversized], 1);
				const result = pruned[0];

				expect(result, "pre-prune must keep the newly marked result").toBeDefined();
				const text = firstTextBlock(result as AgentToolResult<unknown>)?.text ?? "";
				const marker = expectActionableMarker(text, originalBytes);
				expect(text).toBe(marker);
			});
		});

		describe("When truncation re-runs idempotently", () => {
			it("Then actionable marker is not double-truncated", () => {
				const marker = buildTruncationMarker(123);
				const markedResult: AgentToolResult<unknown> = {
					content: [{ type: "text", text: `${"A".repeat(60 * 1024)}\n${marker}\n${"B".repeat(60 * 1024)}` }],
					details: undefined,
				};

				const truncated = truncateOversizedToolResults([markedResult]);
				const result = truncated[0];

				expect(result, "actionable marked result must remain present").toBeDefined();
				expect(result).toEqual(markedResult);
				expect(countMarkerOccurrences(result as AgentToolResult<unknown>)).toBe(1);
			});
		});
	});
});
