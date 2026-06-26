import { describe, expect, test, vi } from "vitest";
import { createBoundedRenderSignature } from "../src/modes/interactive/components/render-signature.ts";

describe("createBoundedRenderSignature", () => {
	test("#given large strings #when creating a render signature #then string hashing work is bounded", () => {
		const largeText = `large-signature:${"a".repeat(64 * 1024)}`;
		const charCodeSpy = vi.spyOn(String.prototype, "charCodeAt");

		try {
			const signature = createBoundedRenderSignature({
				content: largeText,
				nested: [{ details: `large-details:${"b".repeat(64 * 1024)}` }],
			});

			expect(signature).toContain("string length=");
			expect(charCodeSpy.mock.calls.length).toBeLessThan(2_000);
		} finally {
			charCodeSpy.mockRestore();
		}
	});
});
