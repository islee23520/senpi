/**
 * QA fixture: stub select extension (neo plan todo 6).
 *
 * Registers a /stubselect slash command that calls ctx.ui.select with two
 * options and prints the selection to the transcript, so a tmux QA run can
 * prove the extension-UI select round-trip end to end:
 *
 *   senpi --neo ... -e /abs/path/to/packages/neo/qa/fixtures/stub-select-ext.ts
 *   /stubselect  → dialog → pick "option-2" → transcript shows the choice
 *
 * No secrets, no network, no filesystem access — purely the UI bridge.
 */

import type { ExtensionAPI } from "@code-yeongyu/senpi";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("stubselect", {
		description: "QA: pick a stub option via ctx.ui.select",
		handler: async (_args, ctx) => {
			const choice = await ctx.ui.select("Pick a stub option", ["option-1", "option-2"]);
			pi.sendMessage({
				customType: "stub-select-result",
				content: `stubselect: ${choice ?? "cancelled"}`,
				display: true,
			});
		},
	});
}
