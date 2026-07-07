import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import {
	configureModeEnv,
	createDeferred,
	eventually,
	scratchRoot,
	seedFauxConfig,
	startWsAppServerMode,
	stopWsAppServerMode,
	threadIdFromResponse,
	turnIdFromResponse,
} from "./app-server-mode-harness.ts";
import { BufferedSocketReader, initializeSocket, openSocket } from "./app-server-mode-socket.ts";

describe("app-server mode entry", () => {
	it("returns interrupted turn status from thread read after interrupting an active turn", async () => {
		const root = await scratchRoot();
		const completionGate = createDeferred();
		const faux = registerFauxProvider({ schedulerHook: () => completionGate.promise });
		faux.setResponses([fauxAssistantMessage("should not finish before interrupt")]);
		await seedFauxConfig(root, faux);
		configureModeEnv(root);
		const running = await startWsAppServerMode(18992);
		const socket = await openSocket(running.port);
		const reader = new BufferedSocketReader(socket);
		try {
			await initializeSocket(socket, reader);
			socket.send(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: root } }));
			const threadId = threadIdFromResponse(await reader.readUntilResponse(2));
			socket.send(
				JSON.stringify({
					id: 3,
					method: "turn/start",
					params: { threadId, input: [{ type: "text", text: "interrupt me" }] },
				}),
			);
			const turnId = turnIdFromResponse(await reader.readUntilResponse(3));
			await eventually(() => expect(faux.state.callCount).toBe(1));

			socket.send(JSON.stringify({ id: 4, method: "turn/interrupt", params: { threadId, turnId } }));
			expect(await reader.readUntilResponse(4)).toEqual({ id: 4, result: {} });
			expect(await reader.readUntilNotification("turn/completed")).toMatchObject({
				method: "turn/completed",
				params: { threadId, turn: expect.objectContaining({ id: turnId, status: "interrupted" }) },
			});
			socket.send(JSON.stringify({ id: 5, method: "thread/read", params: { threadId, includeTurns: true } }));

			expect(await reader.readUntilResponse(5)).toMatchObject({
				id: 5,
				result: {
					thread: {
						turns: [expect.objectContaining({ id: turnId, status: "interrupted" })],
					},
				},
			});
		} finally {
			reader.dispose();
			socket.close();
			faux.unregister();
			completionGate.resolve();
			await stopWsAppServerMode(running);
		}
	});
});
