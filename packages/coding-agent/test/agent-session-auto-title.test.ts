import { type FauxResponseFactory, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { createHarness, getAssistantTexts, type Harness } from "./suite/harness.ts";

describe("agent session auto title", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("forks title generation from the first task prompt and applies the suggested session name", async () => {
		const titleOrTurn: FauxResponseFactory = (context) => {
			const systemPrompt = Array.isArray(context.systemPrompt)
				? context.systemPrompt.join("\n")
				: (context.systemPrompt ?? "");
			if (systemPrompt.includes("<title>")) {
				return fauxAssistantMessage("<title>Fix OAuth Login</title>");
			}
			return fauxAssistantMessage("turn complete");
		};
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([titleOrTurn, titleOrTurn]);

		await harness.session.prompt("fix the OAuth login button on mobile");

		expect(harness.sessionManager.getSessionName()).toBe("Fix OAuth Login");
		expect(getAssistantTexts(harness)).toEqual(["turn complete"]);
		expect(harness.faux.getCallLog()).toHaveLength(2);
		expect(harness.faux.getCallLog()[0]?.options).toMatchObject({
			sessionId: harness.session.sessionId,
			cacheRetention: "short",
			disableReasoning: true,
		});
	});

	it("defers title generation for low-signal greetings", async () => {
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("hello")]);

		await harness.session.prompt("hi");

		expect(harness.sessionManager.getSessionName()).toBeUndefined();
		expect(getAssistantTexts(harness)).toEqual(["hello"]);
		expect(harness.faux.getCallLog()).toHaveLength(1);
	});
});
