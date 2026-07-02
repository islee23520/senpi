import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "../../../core/agent-session.ts";
import type { TurnLog, TurnStatus } from "./turn-log.ts";

export type ActiveTextItem = { readonly id: string; text: string; completed: boolean };

export type ProjectedNotification = { readonly method: string; readonly params: unknown };

export type ProjectionTurnCompletion = { readonly status: TurnStatus; readonly errorMessage?: string };

export type ProjectionResult = {
	readonly notifications: readonly ProjectedNotification[];
	readonly turnCompletion?: ProjectionTurnCompletion;
};

export interface EventProjectorOptions {
	readonly threadId: string;
	readonly turnId: string;
	readonly turnLog?: TurnLog;
	readonly cwd?: string;
	readonly nowMs?: () => number;
}

export type AssistantMessageEvent = Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];

export function emptyResult(): ProjectionResult {
	return { notifications: [] };
}

export function messageIdFromMessage(message: AssistantMessage): string | undefined {
	return message.responseId;
}

export function assertNeverProjection(value: never): never {
	throw new Error(`Unhandled app-server projection variant: ${String(value)}`);
}
