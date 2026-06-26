import type { TUI } from "@earendil-works/pi-tui";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { ToolExecutionComponent } from "../src/modes/interactive/components/tool-execution.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as TUI;
}

describe("ToolExecutionComponent render signatures", () => {
	beforeAll(() => {
		initTheme("dark");
	});

	test("does not stringify full image results while computing render cache signatures", () => {
		const imageData = `image-data:${"a".repeat(64 * 1024)}`;
		const detailsData = `details-data:${"b".repeat(64 * 1024)}`;
		const component = new ToolExecutionComponent(
			"custom_tool",
			"tool-large-image-result",
			{},
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);

		const originalStringify = JSON.stringify;
		const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
			const rendered = originalStringify(value, replacer, space);
			if (rendered?.includes(imageData) || rendered?.includes(detailsData)) {
				throw new Error("render signature should not JSON.stringify full image payloads");
			}
			return rendered;
		});

		try {
			expect(() =>
				component.updateResult(
					{
						content: [{ type: "image", data: imageData, mimeType: "image/png" }],
						details: {
							screenshotMetadata: {
								data: detailsData,
								width: 1024,
								height: 768,
							},
						},
						isError: false,
					},
					false,
				),
			).not.toThrow();
			expect(() => component.render(120)).not.toThrow();
		} finally {
			stringifySpy.mockRestore();
		}
	});

	test("bounds large image result signature work across repeated renders", () => {
		const component = new ToolExecutionComponent(
			"custom_tool",
			"tool-repeated-large-image-result",
			{},
			{},
			undefined,
			createFakeTui(),
			process.cwd(),
		);
		const charCodeSpy = vi.spyOn(String.prototype, "charCodeAt");

		try {
			component.updateResult(
				{
					content: [{ type: "image", data: `image-data:${"a".repeat(64 * 1024)}`, mimeType: "image/png" }],
					details: {
						screenshotMetadata: {
							data: `details-data:${"b".repeat(64 * 1024)}`,
							width: 1024,
							height: 768,
						},
					},
					isError: false,
				},
				false,
			);
			component.render(120);
			component.render(120);

			expect(charCodeSpy.mock.calls.length).toBeLessThan(4_000);
		} finally {
			charCodeSpy.mockRestore();
		}
	});
});
