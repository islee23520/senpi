import { describe, expect, it } from "vitest";
import type { Model as WireModel } from "../../src/modes/app-server/protocol/generated/v2/Model.ts";
import { STABLE_CLIENT_REQUEST_METHODS } from "../../src/modes/app-server/protocol/methods.ts";
import type { RpcEnvelope } from "../../src/modes/app-server/rpc/envelope.ts";
import { ServerCore } from "../../src/modes/app-server/server/server-core.ts";
import { createHarness } from "./harness.ts";

type SentMessage = RpcEnvelope;

function request(id: string | number, method: string, params?: unknown) {
	return { kind: "request" as const, message: params === undefined ? { id, method } : { id, method, params } };
}

function createCoreWithConnection(options: {
	readonly modelRegistry: Awaited<ReturnType<typeof createHarness>>["session"]["modelRegistry"];
	readonly experimentalApi?: boolean;
}): { readonly core: ServerCore; readonly sent: SentMessage[]; readonly id: string } {
	const core = new ServerCore({
		modelRegistry: options.modelRegistry,
		version: "2026.7.2",
		codexHome: "/tmp/senpi-app-server-test",
	});
	const sent: SentMessage[] = [];
	const connection = core.addConnection({
		id: "conn-models",
		transportKind: "stdio",
		send: (message) => {
			sent.push(message);
		},
		close: () => undefined,
	});
	return { core, sent, id: connection.id };
}

async function initialize(core: ServerCore, id: string, experimentalApi: boolean): Promise<void> {
	await core.receive(
		id,
		request(1, "initialize", {
			clientInfo: { name: "qa", title: "QA", version: "0.0.1" },
			capabilities: { experimentalApi, requestAttestation: false },
		}),
	);
}

function expectResult(response: SentMessage | undefined): unknown {
	expect(response).toEqual({ id: expect.anything(), result: expect.anything() });
	if (response !== undefined && "result" in response) {
		return response.result;
	}
	throw new Error("expected result response");
}

function expectRecord(value: unknown): asserts value is Record<string, unknown> {
	expect(typeof value).toBe("object");
	expect(value).not.toBeNull();
	expect(Array.isArray(value)).toBe(false);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("expected record");
	}
}

function expectModel(value: unknown): asserts value is WireModel {
	expectRecord(value);
	expect(Object.keys(value).sort()).toEqual(
		[
			"additionalSpeedTiers",
			"availabilityNux",
			"defaultReasoningEffort",
			"defaultServiceTier",
			"description",
			"displayName",
			"hidden",
			"id",
			"inputModalities",
			"isDefault",
			"model",
			"serviceTiers",
			"supportedReasoningEfforts",
			"supportsPersonality",
			"upgrade",
			"upgradeInfo",
		].sort(),
	);
}

function withTwoSecondTimeout<T>(promise: Promise<T>): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error("app-server stable method sweep exceeded 2s")), 2000);
	});
	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
	});
}

describe("app-server model methods", () => {
	it("returns non-empty generated-model-compatible catalog entries from configured runtime models", async () => {
		// Given: a faux provider with a runtime key in the same registry path the RPC mode uses.
		const harness = await createHarness({
			models: [{ id: "faux-visible", name: "Faux Visible", reasoning: true, input: ["text", "image"] }],
		});
		try {
			const { core, sent, id } = createCoreWithConnection({ modelRegistry: harness.session.modelRegistry });
			await initialize(core, id, true);

			// When: the app-server client asks for models.
			await core.receive(id, request(2, "model/list", { includeHidden: false }));

			// Then: the response is non-empty and each model carries the generated v2 required field set.
			const result = expectResult(sent[1]);
			expectRecord(result);
			expect(result.nextCursor).toBeNull();
			expect(Array.isArray(result.data)).toBe(true);
			const targetModel = Array.isArray(result.data)
				? result.data.find(
						(model) =>
							typeof model === "object" && model !== null && "id" in model && model.id === "faux/faux-visible",
					)
				: undefined;
			expectModel(targetModel);
			expect(targetModel).toMatchObject({
				id: "faux/faux-visible",
				model: "faux-visible",
				displayName: "Faux Visible",
				description: "",
				hidden: false,
				defaultReasoningEffort: "medium",
				inputModalities: ["text"],
				supportsPersonality: false,
				additionalSpeedTiers: [],
				serviceTiers: [],
				defaultServiceTier: null,
				isDefault: false,
				upgrade: null,
				upgradeInfo: null,
				availabilityNux: null,
			});
			expect(targetModel.supportedReasoningEfforts).toContainEqual({ reasoningEffort: "medium", description: "" });
		} finally {
			harness.cleanup();
		}
	});

	it("returns inactive remote-control status only for experimental clients", async () => {
		// Given: initialized clients with and without the experimental capability.
		const harness = await createHarness();
		try {
			const stable = createCoreWithConnection({
				modelRegistry: harness.session.modelRegistry,
				experimentalApi: false,
			});
			await initialize(stable.core, stable.id, false);
			const experimental = createCoreWithConnection({
				modelRegistry: harness.session.modelRegistry,
				experimentalApi: true,
			});
			await initialize(experimental.core, experimental.id, true);

			// When: both ask for remote-control status.
			await stable.core.receive(stable.id, request(2, "remoteControl/status/read"));
			await experimental.core.receive(experimental.id, request(2, "remoteControl/status/read"));

			// Then: stable clients get the experimental gate and experimental clients get a graceful inactive status.
			expect(stable.sent[1]).toEqual({
				id: 2,
				error: { code: -32600, message: "remoteControl/status/read requires experimentalApi capability" },
			});
			expect(experimental.sent[1]).toEqual({ id: 2, result: { status: "inactive" } });
		} finally {
			harness.cleanup();
		}
	});

	it("returns clean method-not-found responses for unimplemented stable client methods within two seconds", async () => {
		// Given: an initialized connection and the generated stable client method inventory.
		const harness = await createHarness();
		try {
			const { core, sent, id } = createCoreWithConnection({ modelRegistry: harness.session.modelRegistry });
			await initialize(core, id, true);
			const implemented = new Set(["initialize", "model/list"]);
			const unimplementedStableMethods = STABLE_CLIENT_REQUEST_METHODS.filter((method) => !implemented.has(method));

			// When: every currently unimplemented stable method is dispatched.
			await withTwoSecondTimeout(
				Promise.all(
					unimplementedStableMethods.map((method, index) => core.receive(id, request(index + 10, method, {}))),
				).then(() => undefined),
			);

			// Then: every response is well-formed -32601 and no request hangs or crashes the server.
			const responses = sent.slice(1);
			expect(responses).toHaveLength(unimplementedStableMethods.length);
			for (const [index, method] of unimplementedStableMethods.entries()) {
				expect(responses[index]).toEqual({
					id: index + 10,
					error: { code: -32601, message: `Method not found: ${method}` },
				});
			}
		} finally {
			harness.cleanup();
		}
	});
});
