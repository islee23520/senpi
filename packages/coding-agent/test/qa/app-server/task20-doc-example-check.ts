import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

type JsonRecord = Readonly<Record<string, unknown>>;

const request = {
	id: 1,
	method: "initialize",
	params: {
		clientInfo: { name: "task20-docs", title: "Task 20 Docs", version: "0.0.1" },
		capabilities: { experimentalApi: false, requestAttestation: false },
	},
};

const codingAgentDir = process.cwd();
const repoRoot = resolve(codingAgentDir, "../..");
const evidencePath = join(repoRoot, ".omo/evidence/task-20-live-examples.txt");

const child = spawn("npx", ["tsx", "src/cli.ts", "app-server"], {
	cwd: codingAgentDir,
	env: {
		...process.env,
		PI_OFFLINE: "1",
		SENPI_CODING_AGENT_DIR: join(repoRoot, ".omo/evidence/task-20-agent"),
		SENPI_CODING_AGENT_SESSION_DIR: join(repoRoot, ".omo/evidence/task-20-sessions"),
	},
	stdio: ["pipe", "pipe", "pipe"],
});

try {
	const liveLinePromise = readFirstStdoutLine(child, 30_000);
	child.stdin.write(`${JSON.stringify(request)}\n`);
	const liveLine = await liveLinePromise;
	const liveResponse = parseRecord(liveLine, "live initialize response");
	await writeEvidence(liveLine);

	child.stdin.end();
	await waitForExit(child, 30_000);

	const docs = await readFile("docs/app-server.md", "utf8");
	const docResponse = parseRecord(extractInitializeResponseExample(docs), "documented initialize response");
	const liveKeys = sortedKeys(resultRecord(liveResponse, "live initialize response"));
	const docKeys = sortedKeys(resultRecord(docResponse, "documented initialize response"));
	const keysMatch = arraysEqual(liveKeys, docKeys);
	console.log(`LIVE_RESULT_KEYS=${liveKeys.join(",")}`);
	console.log(`DOC_RESULT_KEYS=${docKeys.join(",")}`);
	console.log(`KEYS_MATCH=${keysMatch}`);
	if (!keysMatch) {
		throw new Error("initialize response key sets differ");
	}
} finally {
	child.kill("SIGTERM");
	await delay(100);
	child.kill("SIGKILL");
}

function readFirstStdoutLine(childProcess: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<string> {
	return new Promise((resolveLine, rejectLine) => {
		let buffer = "";
		const timeout = setTimeout(() => {
			rejectLine(new Error(`stdout line not observed within ${timeoutMs}ms`));
		}, timeoutMs);
		childProcess.stdout.setEncoding("utf8");
		childProcess.stderr.setEncoding("utf8");
		childProcess.stdout.on("data", (chunk: string) => {
			buffer += chunk;
			const newline = buffer.indexOf("\n");
			if (newline === -1) {
				return;
			}
			clearTimeout(timeout);
			resolveLine(buffer.slice(0, newline));
		});
		childProcess.once("exit", (code: number | null) => {
			clearTimeout(timeout);
			rejectLine(new Error(`app-server exited before initialize response: ${String(code)}`));
		});
	});
}

function waitForExit(childProcess: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<void> {
	return new Promise((resolveExit, rejectExit) => {
		const timeout = setTimeout(() => {
			rejectExit(new Error(`app-server exit not observed within ${timeoutMs}ms`));
		}, timeoutMs);
		childProcess.once("exit", () => {
			clearTimeout(timeout);
			resolveExit();
		});
	});
}

async function writeEvidence(liveLine: string): Promise<void> {
	await mkdir(resolve(evidencePath, ".."), { recursive: true });
	await writeFile(evidencePath, `${JSON.stringify(request)}\n${liveLine}\n`);
}

function extractInitializeResponseExample(markdown: string): string {
	const heading = markdown.search(/^#{2,6} .*initialize\b/im);
	if (heading === -1) {
		throw new Error("initialize heading not found in docs/app-server.md");
	}
	const afterHeading = markdown.slice(heading);
	const block = afterHeading.match(/```json\s*([\s\S]*?)```/);
	if (!block) {
		throw new Error("initialize JSON example block not found in docs/app-server.md");
	}
	const [, json] = block;
	if (json === undefined) {
		throw new Error("initialize JSON example block was empty");
	}
	return json.trim();
}

function parseRecord(text: string, label: string): JsonRecord {
	const parsed: unknown = JSON.parse(text);
	if (!isRecord(parsed)) {
		throw new Error(`${label} is not a JSON object`);
	}
	return parsed;
}

function resultRecord(response: JsonRecord, label: string): JsonRecord {
	const result = response.result;
	if (!isRecord(result)) {
		throw new Error(`${label} result is not a JSON object`);
	}
	return result;
}

function sortedKeys(record: JsonRecord): readonly string[] {
	return Object.keys(record).sort();
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
