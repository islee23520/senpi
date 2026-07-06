import {
	formatAppServerUsage,
	parseAppServerCliArgs,
	runAppServerDaemonCommand,
	runAppServerMode,
} from "../modes/app-server/index.ts";

export async function handleAppServerCommand(args: readonly string[]): Promise<boolean> {
	if (args[0] !== "app-server") {
		return false;
	}

	const parsed = parseAppServerCliArgs(args.slice(1));
	if (parsed.kind === "usage-error") {
		console.error(`Error: ${parsed.message}`);
		console.error(formatAppServerUsage());
		process.exit(2);
	}

	switch (parsed.kind) {
		case "daemon":
			await runAppServerDaemonCommand(parsed);
			return true;
		case "server":
			await runAppServerMode(parsed);
			return true;
	}
}
