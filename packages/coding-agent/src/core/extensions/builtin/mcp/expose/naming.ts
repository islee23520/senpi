import { createHash } from "node:crypto";

export interface McpToolNameEntry {
	serverName: string;
	toolName: string;
}

export const MCP_TOOL_NAME_MAX_LENGTH = 64;

type WarnFn = (message: string) => void;

export function buildMcpToolNames(entries: readonly McpToolNameEntry[], warn?: WarnFn): string[] {
	const bases = entries.map((entry) => ellipsizeMiddle(buildBaseName(entry), MCP_TOOL_NAME_MAX_LENGTH));
	const groups = new Map<string, number[]>();
	for (let index = 0; index < bases.length; index += 1) {
		const key = matcherKey(bases[index]!);
		const indexes = groups.get(key) ?? [];
		indexes.push(index);
		groups.set(key, indexes);
	}

	const names = [...bases];
	for (const indexes of groups.values()) {
		if (indexes.length < 2) continue;
		warn?.(
			`MCP tool name collision after normalization for '${bases[indexes[0]!]!}'; appended deterministic suffixes.`,
		);
		for (const index of indexes) {
			const entry = entries[index]!;
			const suffix = hashSuffix(entry);
			names[index] = `${ellipsizeMiddle(bases[index]!, MCP_TOOL_NAME_MAX_LENGTH - suffix.length)}${suffix}`;
		}
	}
	return names;
}

export function buildMcpToolName(entry: McpToolNameEntry): string {
	return ellipsizeMiddle(buildBaseName(entry), MCP_TOOL_NAME_MAX_LENGTH);
}

function buildBaseName(entry: McpToolNameEntry): string {
	return `mcp_${sanitizeNamePart(entry.serverName)}_${sanitizeNamePart(entry.toolName)}`;
}

function sanitizeNamePart(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function matcherKey(name: string): string {
	return name.replace(/-/g, "_");
}

function hashSuffix(entry: McpToolNameEntry): string {
	return `_${createHash("sha1").update(`${entry.serverName}\0${entry.toolName}`).digest("hex").slice(0, 4)}`;
}

function ellipsizeMiddle(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);
	const marker = "...";
	const remaining = maxLength - marker.length;
	const prefixLength = Math.ceil(remaining / 2);
	const suffixLength = Math.floor(remaining / 2);
	return `${value.slice(0, prefixLength)}${marker}${value.slice(value.length - suffixLength)}`;
}
