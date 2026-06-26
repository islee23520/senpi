import type { AssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, test, vi } from "vitest";
import { AssistantMessageComponent } from "../src/modes/interactive/components/assistant-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createAssistantMessage(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("AssistantMessageComponent render signatures", () => {
	test("#given large resumed assistant text #when rendering #then signature does not stringify full content", () => {
		initTheme("dark");
		const largeText = `large-assistant-content:${"a".repeat(64 * 1024)}`;
		const originalStringify = JSON.stringify;
		const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
			const rendered = originalStringify(value, replacer, space);
			if (rendered?.includes(largeText)) {
				throw new Error("assistant message signature should not JSON.stringify full content");
			}
			return rendered;
		});

		try {
			const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: largeText }]));
			expect(() => component.render(120)).not.toThrow();
		} finally {
			stringifySpy.mockRestore();
		}
	});

	test("#given equal-length large assistant updates #when rendering #then the latest content is shown", () => {
		initTheme("dark");
		const oldText = `OLDMARKER:${"a".repeat(64 * 1024)}`;
		const newText = `NEWMARKER:${"b".repeat(64 * 1024)}`;
		const component = new AssistantMessageComponent(createAssistantMessage([{ type: "text", text: oldText }]));

		expect(component.render(120).join("\n")).toContain("OLDMARKER");

		component.updateContent(createAssistantMessage([{ type: "text", text: newText }]));
		const rendered = component.render(120).join("\n");

		expect(newText).toHaveLength(oldText.length);
		expect(rendered).toContain("NEWMARKER");
		expect(rendered).not.toContain("OLDMARKER");
	});

	test("#given assistant content after the signature item limit changes #when rendering #then the tail update is shown", () => {
		initTheme("dark");
		const unchangedPrefix = Array.from({ length: 40 }, (_item, index) => ({
			type: "text" as const,
			text: `prefix-${index}`,
		}));
		const component = new AssistantMessageComponent(
			createAssistantMessage([...unchangedPrefix, { type: "text", text: "TAILOLD" }]),
		);

		expect(component.render(120).join("\n")).toContain("TAILOLD");

		component.updateContent(createAssistantMessage([...unchangedPrefix, { type: "text", text: "TAILNEW" }]));
		const rendered = component.render(120).join("\n");

		expect(rendered).toContain("TAILNEW");
		expect(rendered).not.toContain("TAILOLD");
	});

	test("#given provider native Date changes #when rendering #then JSON-visible body updates", () => {
		initTheme("dark");
		const component = new AssistantMessageComponent(
			createAssistantMessage([
				{
					type: "providerNative",
					subtype: "date_test",
					raw: { date: new Date("2026-06-26T00:00:00.000Z") },
				},
			]),
		);

		expect(component.render(160).join("\n")).toContain("2026-06-26T00:00:00.000Z");

		component.updateContent(
			createAssistantMessage([
				{
					type: "providerNative",
					subtype: "date_test",
					raw: { date: new Date("2027-06-26T00:00:00.000Z") },
				},
			]),
		);
		const rendered = component.render(160).join("\n");

		expect(rendered).toContain("2027-06-26T00:00:00.000Z");
		expect(rendered).not.toContain("2026-06-26T00:00:00.000Z");
	});
});
