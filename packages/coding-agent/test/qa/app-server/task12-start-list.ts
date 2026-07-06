import { existsSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Api, getModel, type Model } from "@earendil-works/pi-ai/compat";
import { type CreateAgentSessionOptions, createAgentSession } from "../../../src/core/sdk.ts";
import { createRegistry, type RegistryConnection } from "../../../src/modes/app-server/rpc/registry.ts";
import {
	NotificationRouter,
	type RoutableConnection,
	type RouterNotification,
} from "../../../src/modes/app-server/server/notifications.ts";
import { registerThreadLifecycleHandlers } from "../../../src/modes/app-server/threads/handlers.ts";
import { ThreadRegistry } from "../../../src/modes/app-server/threads/registry.ts";
import { TurnLog } from "../../../src/modes/app-server/threads/turn-log.ts";

class FakeConnection implements RoutableConnection, RegistryConnection {
	readonly id = "qa-conn";
	readonly transport = "ws";
	readonly capabilities = { experimentalApi: true };
	readonly received: RouterNotification[] = [];
	initialized = true;
	optOutNotificationMethods: readonly string[] | null = null;

	send(notification: RouterNotification): void {
		this.received.push(notification);
	}
}

const scratchRoot = join(tmpdir(), `senpi-qa-task12-start-list-${process.pid}`);

async function main(): Promise<void> {
	rmSync(scratchRoot, { recursive: true, force: true });
	let runError: unknown;
	try {
		const requestedModel: Model<Api> = getModel("openai", "gpt-5");
		const createdModels: Array<Model<Api> | undefined> = [];
		const connection = new FakeConnection();
		const registry = createRegistry();
		const threads = new ThreadRegistry({
			agentDir: join(scratchRoot, "agent"),
			sessionDir: join(scratchRoot, "sessions"),
			createSession: async (options: CreateAgentSessionOptions) => {
				createdModels.push(options.model);
				return createAgentSession(options);
			},
		});
		registerThreadLifecycleHandlers(registry, {
			threads,
			turnLog: new TurnLog(),
			notifications: new NotificationRouter({ connections: [connection] }),
			idleUnloadMinutes: 10,
		});
		for (let index = 0; index < 26; index += 1) {
			await writePersistedSession(`00000000-0000-0000-0000-${String(index).padStart(12, "0")}`);
		}
		const start = await registry.dispatch(connection, {
			id: 1,
			method: "thread/start",
			params: { cwd: scratchRoot, model: "gpt-5", modelProvider: "openai", approvalPolicy: "on-request" },
		});
		const list = await registry.dispatch(connection, { id: 2, method: "thread/list", params: {} });
		const startResult = responseResult(start);
		const listResult = responseResult(list);
		const dataLength = dataArray(listResult).length;
		console.log(`START_MODEL=${String(startResult.modelProvider)}/${String(startResult.model)}`);
		console.log(`START_APPROVAL=${String(startResult.approvalPolicy)}`);
		console.log(`CREATE_MODEL=${createdModels[0]?.provider}/${createdModels[0]?.id}`);
		console.log(`LIST_DEFAULT_LENGTH=${dataLength}`);
		console.log(`LIST_NEXT_CURSOR=${String(listResult.nextCursor)}`);
		if (createdModels[0]?.provider !== requestedModel.provider || createdModels[0]?.id !== requestedModel.id) {
			throw new Error("requested model was not passed to createSession");
		}
		if (startResult.approvalPolicy !== "on-request") {
			throw new Error(`unexpected approval policy: ${String(startResult.approvalPolicy)}`);
		}
		if (dataLength !== 25 || listResult.nextCursor === null) {
			throw new Error("thread/list did not use the default page size");
		}
	} catch (error) {
		if (error instanceof Error) {
			runError = error;
		} else {
			throw error;
		}
	}
	rmSync(scratchRoot, { recursive: true, force: true });
	if (existsSync(scratchRoot)) {
		throw new Error(`cleanup failed: ${scratchRoot}`);
	}
	console.log(`CLEANUP=removed:${scratchRoot}`);
	if (runError) {
		throw runError;
	}
}

async function writePersistedSession(threadId: string): Promise<void> {
	const sessionDir = join(scratchRoot, "sessions");
	await mkdir(sessionDir, { recursive: true });
	const sessionFile = join(sessionDir, `2026-07-02T00-00-00-000Z_${threadId}.jsonl`);
	await writeFile(
		sessionFile,
		[
			JSON.stringify({
				type: "session",
				version: 3,
				id: threadId,
				timestamp: "2026-07-02T00:00:00.000Z",
				cwd: scratchRoot,
			}),
			"",
		].join("\n"),
	);
}

function responseResult(
	response: Awaited<ReturnType<ReturnType<typeof createRegistry>["dispatch"]>>,
): Record<string, unknown> {
	if ("error" in response) {
		throw new Error(response.error.message);
	}
	return objectValue(response.result);
}

function dataArray(value: unknown): unknown[] {
	const object = objectValue(value);
	if (!Array.isArray(object.data)) {
		throw new Error("expected data array");
	}
	return object.data;
}

function objectValue(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected object");
	}
	return Object.fromEntries(Object.entries(value));
}

await main();
