import { describe, expect, it } from "vitest";
import type { ModelListResponse } from "../../src/modes/app-server/protocol/models.ts";
import { buildModelListResponse } from "../../src/modes/app-server/server/models.ts";
import { createHarness } from "./harness.ts";

describe("app-server model/list pagination", () => {
	it("paginates visible models with numeric cursors and clamps zero limits", async () => {
		// Given: three available models and one model hidden from the default picker.
		const harness = await createHarness({
			models: [
				{ id: "first", name: "First", reasoning: true, input: ["text"] },
				{ id: "second", name: "Second", reasoning: true, input: ["text"] },
				{ id: "third", name: "Third", reasoning: true, input: ["text"] },
			],
		});
		try {
			const available = harness.session.modelRegistry.getAvailable();
			const first = available[0];
			if (!first) throw new Error("model fixture did not register");
			const hidden = { ...first, id: "hidden", name: "Hidden", hidden: true };
			const models = [first, hidden, ...available.slice(1)];

			// When: the client requests pages and a zero-sized page.
			const firstPage: ModelListResponse = buildModelListResponse(models, {
				cursor: null,
				limit: 1,
				includeHidden: false,
			});
			const secondPage = buildModelListResponse(models, {
				cursor: firstPage.nextCursor,
				limit: 1,
				includeHidden: false,
			});
			const clampedPage = buildModelListResponse(models, { limit: 0, includeHidden: false });
			const negativeClampedPage = buildModelListResponse(models, { limit: -10, includeHidden: false });
			const hiddenPage = buildModelListResponse(models, { limit: 10, includeHidden: true });

			// Then: cursors are numeric offsets, zero becomes one, and hidden models are opt-in.
			expect(firstPage.data.map((model) => model.model)).toEqual(["first"]);
			expect(firstPage.nextCursor).toBe("1");
			expect(secondPage.data.map((model) => model.model)).toEqual(["second"]);
			expect(clampedPage.data).toHaveLength(1);
			expect(negativeClampedPage.data).toHaveLength(1);
			expect(hiddenPage.data.some((model) => model.hidden && model.model === "hidden")).toBe(true);
			for (const model of hiddenPage.data) {
				expect(model.serviceTiers).toEqual([]);
				expect(model.defaultServiceTier).toBeNull();
			}
		} finally {
			harness.cleanup();
		}
	});
});
