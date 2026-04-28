import { fauxAssistantMessage } from "@mariozechner/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { CompactionResult } from "../../src/core/compaction/index.js";
import { createHarness, type Harness } from "./harness.js";

function createPrecomputedCompaction(harness: Harness, summary: string): CompactionResult {
	const firstEntry = harness.sessionManager.getEntries()[0];
	if (!firstEntry) {
		throw new Error("Expected at least one session entry");
	}

	return {
		summary,
		firstKeptEntryId: firstEntry.id,
		tokensBefore: 42,
		details: { source: "test" },
	};
}

describe("AgentSession applyCompaction", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	it("returns stale when expected revision no longer matches", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one")]);
		const expectedRevision = harness.session.getMessageRevision();

		await harness.session.prompt("one");
		const precomputed = createPrecomputedCompaction(harness, "stale summary");

		// when
		const result = await harness.session.applyCompaction(precomputed, {
			reason: "extension",
			expectedRevision,
		});

		// then
		expect(result).toEqual({ applied: false, reason: "stale" });
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(0);
	});

	it("applies precomputed compaction when expected revision matches", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one")]);

		await harness.session.prompt("one");
		const expectedRevision = harness.session.getMessageRevision();
		const precomputed = createPrecomputedCompaction(harness, "fresh summary");

		// when
		const result = await harness.session.applyCompaction(precomputed, {
			reason: "extension",
			expectedRevision,
		});

		// then
		expect(result).toEqual({ applied: true, reason: "ok" });
		expect(harness.session.messages[0]?.role).toBe("compactionSummary");
		expect(harness.sessionManager.getEntries().filter((entry) => entry.type === "compaction")).toHaveLength(1);
	});

	it("increments message revision monotonically for message and compaction mutations", async () => {
		// given
		const harness = await createHarness();
		harnesses.push(harness);
		harness.setResponses([fauxAssistantMessage("one")]);
		const initialRevision = harness.session.getMessageRevision();

		// when
		await harness.session.prompt("one");
		const afterPromptRevision = harness.session.getMessageRevision();
		const precomputed = createPrecomputedCompaction(harness, "monotonic summary");
		await harness.session.applyCompaction(precomputed, {
			reason: "extension",
			expectedRevision: afterPromptRevision,
		});
		const afterCompactionRevision = harness.session.getMessageRevision();

		// then
		expect(afterPromptRevision).toBeGreaterThan(initialRevision);
		expect(afterCompactionRevision).toBeGreaterThan(afterPromptRevision);
	});
});
