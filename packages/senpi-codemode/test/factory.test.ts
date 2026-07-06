import type { ExtensionAPI } from "@code-yeongyu/senpi";
import { describe, expect, it } from "vitest";
import senpiCodemode from "../src/index.ts";

describe("senpi-codemode extension factory", () => {
	it("runs without registering tools during scaffold", () => {
		const registeredTools: string[] = [];
		const pi = {
			registerTool(tool: { readonly name: string }) {
				registeredTools.push(tool.name);
			},
		} as ExtensionAPI;

		expect(() => senpiCodemode(pi)).not.toThrow();
		expect(registeredTools).toEqual([]);
	});
});
