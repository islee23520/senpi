import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Goal } from "./types.ts";

export function shouldQueueGoalContinuationWhenIdle(
	goal: Goal | null,
	isIdle: boolean,
	hasPendingMessages: boolean,
): goal is Goal {
	return goal?.status === "active" && isIdle && !hasPendingMessages;
}

export function shouldQueueGoalContinuationAfterAgentEnd(
	goal: Goal | null,
	hasPendingMessages: boolean,
	messages: readonly AgentMessage[],
): goal is Goal {
	return goal?.status === "active" && !hasPendingMessages && didAgentEndCleanly(messages);
}

function didAgentEndCleanly(messages: readonly AgentMessage[]): boolean {
	const lastAssistant = findLastAssistantMessage(messages);
	return (
		lastAssistant === undefined || (lastAssistant.stopReason !== "aborted" && lastAssistant.stopReason !== "error")
	);
}

function findLastAssistantMessage(messages: readonly AgentMessage[]) {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === "assistant") {
			return message;
		}
	}
	return undefined;
}
