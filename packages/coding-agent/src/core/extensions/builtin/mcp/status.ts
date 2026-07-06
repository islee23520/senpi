import type { ServerConnection } from "./connection.ts";
import type { McpServerSnapshot } from "./service.ts";

export interface McpStatusRow {
	readonly snapshot: McpServerSnapshot;
	readonly toolCount: number | null;
}

export async function buildMcpStatusRows(
	snapshots: readonly McpServerSnapshot[],
	getConnection: (name: string) => ServerConnection | undefined,
): Promise<McpStatusRow[]> {
	return Promise.all(
		snapshots.map(async (snapshot) => ({
			snapshot,
			toolCount: await readToolCount(snapshot, getConnection(snapshot.name)),
		})),
	);
}

export function formatMcpStatus(title: string, rows: readonly McpStatusRow[]): string {
	return [title, ...rows.map(formatRow)].join("\n");
}

function formatRow(row: McpStatusRow): string {
	const snapshot = row.snapshot;
	const averageLatencyMs =
		snapshot.counters.callCount === 0
			? 0
			: Math.round(snapshot.counters.totalLatencyMs / snapshot.counters.callCount);
	return [
		snapshot.name,
		snapshot.configState,
		`state=${snapshot.lifecycleState}`,
		`source=${snapshot.sourcePath ?? "n/a"}`,
		`tools=${row.toolCount ?? "?"}`,
		`uptime=${formatUptime(snapshot.uptimeMs)}`,
		`calls=${snapshot.counters.callCount}`,
		`errors=${snapshot.counters.errorCount}`,
		`latency=${averageLatencyMs}ms`,
		`reconnects=${snapshot.counters.reconnectCount}`,
		snapshot.lastError ? `lastError=${snapshot.lastError}` : "",
	]
		.filter((part) => part.length > 0)
		.join(" ");
}

function formatUptime(uptimeMs: number | null): string {
	if (uptimeMs === null) return "n/a";
	if (uptimeMs < 1000) return "<1s";
	return `${Math.round(uptimeMs / 1000)}s`;
}

async function readToolCount(
	snapshot: McpServerSnapshot,
	connection: ServerConnection | undefined,
): Promise<number | null> {
	if (snapshot.lifecycleState !== "connected" || connection === undefined) return null;
	try {
		const result = await connection.client.listTools({}, { timeout: 500 });
		return result.tools.length;
	} catch (error) {
		return unavailableToolCount(error instanceof Error ? error : new Error(String(error)));
	}
}

function unavailableToolCount(_error: Error): null {
	// Tool counts are display-only status detail. If a connected server rejects
	// tools/list, keep /mcp status responsive and render the count as unavailable.
	return null;
}
