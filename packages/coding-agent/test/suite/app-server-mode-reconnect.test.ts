import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { describe, expect, it } from "vitest";
import type WebSocket from "ws";
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
import { BufferedSocketReader, closeSocket, initializeSocket, openSocket } from "./app-server-mode-socket.ts";

describe("app-server mode entry", () => {
	it("continues an active turn when a websocket closes mid-turn and replays terminal completion", async () => {
		const root = await scratchRoot();
		const completionGate = createDeferred();
		const faux = registerFauxProvider({ schedulerHook: () => completionGate.promise });
		faux.setResponses([fauxAssistantMessage("close-mid-turn complete")]);
		await seedFauxConfig(root, faux);
		configureModeEnv(root);
		const running = await startWsAppServerMode(18991);
		const firstSocket = await openSocket(running.port);
		const firstReader = new BufferedSocketReader(firstSocket);
		let secondReader: BufferedSocketReader | undefined;
		let secondSocket: WebSocket | undefined;
		try {
			await initializeSocket(firstSocket, firstReader);
			firstSocket.send(JSON.stringify({ id: 2, method: "thread/start", params: { cwd: root } }));
			const threadId = threadIdFromResponse(await firstReader.readUntilResponse(2));
			firstSocket.send(
				JSON.stringify({
					id: 3,
					method: "turn/start",
					params: { threadId, input: [{ type: "text", text: "continue after websocket close" }] },
				}),
			);
			const turnResponse = await firstReader.readUntilResponse(3);
			const turnId = turnIdFromResponse(turnResponse);
			expect(await firstReader.readUntilNotification("turn/started")).toMatchObject({
				method: "turn/started",
				params: { threadId, turn: expect.objectContaining({ id: turnId, status: "inProgress" }) },
			});

			await eventually(() => expect(faux.state.callCount).toBe(1));
			firstReader.dispose();
			await closeSocket(firstSocket);
			secondSocket = await openSocket(running.port);
			secondReader = new BufferedSocketReader(secondSocket);
			await initializeSocket(secondSocket, secondReader);
			secondSocket.send(JSON.stringify({ id: 4, method: "thread/loaded/list", params: {} }));
			expect(await secondReader.readUntilResponse(4)).toMatchObject({
				id: 4,
				result: {
					data: [threadId],
				},
			});
			completionGate.resolve();
			secondSocket.send(JSON.stringify({ id: 5, method: "thread/resume", params: { threadId } }));

			const completed = await secondReader.readUntilNotification("turn/completed");
			expect(completed).toMatchObject({
				method: "turn/completed",
				params: { threadId, turn: expect.objectContaining({ id: turnId, status: "completed" }) },
			});
			expect(await secondReader.readUntilResponse(5)).toMatchObject({
				id: 5,
				result: { thread: expect.objectContaining({ id: threadId }) },
			});
			secondSocket.send(JSON.stringify({ id: 6, method: "thread/loaded/list", params: {} }));
			expect(await secondReader.readUntilResponse(6)).toMatchObject({
				id: 6,
				result: { data: [threadId] },
			});
			expect(faux.state.callCount).toBe(1);
		} finally {
			firstReader.dispose();
			firstSocket.close();
			secondReader?.dispose();
			secondSocket?.close();
			faux.unregister();
			completionGate.resolve();
			await stopWsAppServerMode(running);
		}
	});
});
