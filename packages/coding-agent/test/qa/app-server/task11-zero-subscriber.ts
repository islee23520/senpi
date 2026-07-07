import { ApprovalBridge, type AppServerOutboundMessage } from "../../../src/modes/app-server/server/approvals.ts";

const startedAt = Date.now();
const sent: AppServerOutboundMessage[] = [];
const bridge = new ApprovalBridge((_threadId, message) => {
	sent.push(message);
	return 0;
});

const outcome = await bridge.requestApproval("t1", "commandExecution", {
	turnId: "turn-1",
	itemId: "item-1",
	toolName: "bash",
	command: "rm -rf /tmp/x",
});
const elapsedMs = Date.now() - startedAt;
const passed =
	outcome.decision === "decline" &&
	outcome.reason === "no client connected to approve" &&
	elapsedMs < 500 &&
	sent.length === 1 &&
	sent[0]?.method === "item/commandExecution/requestApproval";

console.log(`DECISION=${outcome.decision} MS=${elapsedMs < 500}`);
if (!passed) {
	process.exitCode = 1;
}
