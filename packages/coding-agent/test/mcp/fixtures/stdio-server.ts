import { spawn } from "node:child_process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { delaySlowStart, maybeWedge, parseFixtureOptions } from "./options.ts";
import { createFixtureServer } from "./sdk-server.ts";

async function main(): Promise<void> {
	const options = parseFixtureOptions(process.argv.slice(2));
	if (maybeWedge(options)) return;
	await delaySlowStart(options);
	if (options.spawnGrandchild) {
		const child = spawn(process.execPath, ["-e", "setInterval(() => undefined, 60000);"], { stdio: "ignore" });
		process.stderr.write(`stdio fixture grandchild pid=${child.pid ?? "unknown"}\n`);
	}
	const server = createFixtureServer(options);
	await server.connect(new StdioServerTransport());
	process.stderr.write(`stdio fixture ready pid=${process.pid}\n`);
}

main().catch((error: unknown) => {
	process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
	process.exit(1);
});
