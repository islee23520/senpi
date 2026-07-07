import type { JsonValue, RequestId } from "../protocol/index.ts";

export type ApprovalKind = "commandExecution" | "fileChange";
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";
export type ApprovalOutcome = {
	readonly allow: boolean;
	readonly decision: ApprovalDecision;
	readonly reason?: string;
};
export type ApprovalPayload = Readonly<{
	turnId?: string;
	itemId?: string;
	approvalId?: string | null;
	environmentId?: string | null;
	reason?: string | null;
	toolName?: string;
	command?: string | null;
	cwd?: string | null;
	grantRoot?: string | null;
}>;
export type AppServerApprovalRequest = Readonly<{
	id: RequestId;
	method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval";
	params: JsonValue;
}>;
export type AppServerOutboundMessage =
	| AppServerApprovalRequest
	| {
			readonly method: "serverRequest/resolved";
			readonly params: { readonly threadId: string; readonly requestId: RequestId };
	  };
export type SendToThreadSubscribers = (threadId: string, message: AppServerOutboundMessage) => number;
export type ApprovalResponse = { readonly id: RequestId; readonly result?: unknown; readonly error?: unknown };

export const APPROVAL_DECISIONS = ["accept", "acceptForSession", "decline", "cancel"] as const;
export const PERMISSION_OPTIONS = ["Allow once", "Allow always", "Deny", "Deny with feedback"] as const;
export const CANCEL_REASON = "approval request was cancelled because the turn ended";
export const NO_SUBSCRIBER_REASON = "no client connected to approve";
