export const MCP_STARTUP_RACE_MS = 250;

export type McpStartupRaceResult = "settled" | "timeout";

export async function waitForMcpStartupRace(
	connect: Promise<void>,
	deadlineMs = MCP_STARTUP_RACE_MS,
): Promise<McpStartupRaceResult> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			connect.then(() => "settled" as const),
			new Promise<"timeout">((resolve) => {
				timeout = setTimeout(() => resolve("timeout"), deadlineMs);
				timeout.unref();
			}),
		]);
	} finally {
		if (timeout !== undefined) clearTimeout(timeout);
	}
}

export function shouldRaceMcpStartup(lifecycle: "lazy" | "eager" | "keep-alive"): boolean {
	return lifecycle === "eager" || lifecycle === "keep-alive";
}
