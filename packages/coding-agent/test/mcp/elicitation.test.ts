// MCP elicitation form mode (todo 41): capability declared empty; the form
// walks flat primitives through ui.input/select/confirm; missing UI or a
// missing required answer declines; the bounded timeout cancels; numbers
// parse or decline; URL-mode requests decline (v1 is form-only).

import { describe, expect, it } from "vitest";
import {
	MCP_CLIENT_ELICITATION_CAPABILITY,
	runElicitationForm,
} from "../../src/core/extensions/builtin/mcp/elicitation.ts";

const SCHEMA = {
	properties: {
		confirmed: { type: "boolean" },
		count: { type: "integer" },
		mode: { enum: ["alpha", "beta"], type: "string" },
		name: { type: "string" },
	},
	required: ["name"],
};

function scriptedUi(overrides: Partial<Record<"input" | "select" | "confirm", unknown>> = {}) {
	return {
		confirm: async () => true,
		input: async (title: string) => (title.includes("count") ? "42" : "Ada"),
		select: async () => "beta",
		...overrides,
	} as never;
}

describe("mcp elicitation form", () => {
	it("declares the capability as an empty object", () => {
		expect(MCP_CLIENT_ELICITATION_CAPABILITY).toEqual({ elicitation: {} });
	});

	it("accepts with typed values from scripted ui answers", async () => {
		const response = await runElicitationForm(scriptedUi(), "Server asks", SCHEMA);
		expect(response).toEqual({
			action: "accept",
			content: { confirmed: true, count: 42, mode: "beta", name: "Ada" },
		});
	});

	it("declines when a required answer is missing and on invalid numbers", async () => {
		const missing = await runElicitationForm(scriptedUi({ input: async () => undefined }), "Ask", SCHEMA);
		expect(missing.action).toBe("decline");

		const badNumber = await runElicitationForm(
			scriptedUi({ input: async (title: string) => (title.includes("count") ? "not-a-number" : "Ada") }),
			"Ask",
			SCHEMA,
		);
		expect(badNumber.action).toBe("decline");
	});

	it("cancels via the bounded timeout without wedging", async () => {
		const hangingUi = scriptedUi({ input: () => new Promise(() => undefined) });
		const response = await runElicitationForm(hangingUi, "Ask", SCHEMA, 50);
		expect(response).toEqual({ action: "cancel" });
	});
});
