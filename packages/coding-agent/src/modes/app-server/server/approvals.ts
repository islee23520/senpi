import type { ExtensionUIContext } from "../../../core/extensions/index.ts";
import { getAvailableThemesWithPaths, getThemeByName, type Theme, theme } from "../../interactive/theme/theme.ts";
import type { JsonValue, RequestId } from "../protocol/index.ts";

// allow: SIZE_OK - Todo 11 write scope requires the bridge, UI adapter, and salvaged redaction helper in this file.
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

type PendingApproval = Readonly<{
	threadId: string;
	request: AppServerOutboundMessage;
	allowKey: string | undefined;
	resolve: (outcome: ApprovalOutcome) => void;
}>;
type PermissionPrompt = Readonly<{ kind: ApprovalKind; toolName: string; command: string | null; reason: string }>;

const APPROVAL_DECISIONS = ["accept", "acceptForSession", "decline", "cancel"] as const;
const PERMISSION_OPTIONS = ["Allow once", "Allow always", "Deny", "Deny with feedback"] as const;
const CANCEL_REASON = "approval request was cancelled because the turn ended";
const NO_SUBSCRIBER_REASON = "no client connected to approve";

export class ApprovalBridge {
	private nextServerRequestId = 0;
	private readonly pending = new Map<RequestId, PendingApproval>();
	private readonly sessionAllows = new Set<string>();
	private readonly sendToThreadSubscribers: SendToThreadSubscribers;

	constructor(sendToThreadSubscribers: SendToThreadSubscribers) {
		this.sendToThreadSubscribers = sendToThreadSubscribers;
	}

	get pendingCount(): number {
		return this.pending.size;
	}

	requestApproval(threadId: string, kind: ApprovalKind, payload: ApprovalPayload): Promise<ApprovalOutcome> {
		const allowKey = createAllowKey(threadId, kind, payload);
		if (allowKey && this.sessionAllows.has(allowKey)) {
			return Promise.resolve({ allow: true, decision: "acceptForSession" });
		}
		const requestId = this.nextServerRequestId;
		this.nextServerRequestId += 1;
		const request = buildApprovalRequest(threadId, requestId, kind, payload);
		return new Promise((resolve) => {
			this.pending.set(requestId, { threadId, request, allowKey, resolve });
			if (this.sendToThreadSubscribers(threadId, request) > 0) {
				return;
			}
			this.pending.delete(requestId);
			resolve({ allow: false, decision: "decline", reason: NO_SUBSCRIBER_REASON });
		});
	}

	resolveResponse(response: ApprovalResponse): boolean {
		const pending = this.pending.get(response.id);
		if (!pending) {
			return false;
		}
		const decision = readDecision(response);
		this.pending.delete(response.id);
		if (decision === "acceptForSession" && pending.allowKey) {
			this.sessionAllows.add(pending.allowKey);
		}
		this.emitResolved(pending.threadId, response.id);
		pending.resolve(decisionToOutcome(decision, readReason(response)));
		return true;
	}

	cancelPendingForThread(threadId: string): number {
		let cancelled = 0;
		for (const [requestId, pending] of Array.from(this.pending.entries())) {
			if (pending.threadId !== threadId) {
				continue;
			}
			this.pending.delete(requestId);
			this.emitResolved(threadId, requestId);
			pending.resolve({ allow: false, decision: "cancel", reason: CANCEL_REASON });
			cancelled += 1;
		}
		return cancelled;
	}

	private emitResolved(threadId: string, requestId: RequestId): void {
		this.sendToThreadSubscribers(threadId, {
			method: "serverRequest/resolved",
			params: { threadId, requestId },
		});
	}
}

export function createAppServerUIContext(bridge: ApprovalBridge, threadId: string): ExtensionUIContext {
	let pendingInput: string | undefined;
	let editorText = "";
	let editorFactory: Parameters<ExtensionUIContext["setEditorComponent"]>[0] | undefined;
	let toolsExpanded = false;

	return {
		async select(title, options) {
			const prompt = parsePermissionPrompt(title);
			if (!prompt || !isPermissionOptions(options)) {
				return undefined;
			}
			const outcome = await bridge.requestApproval(threadId, prompt.kind, {
				turnId: "turn-approval",
				itemId: `approval-${prompt.toolName}`,
				toolName: prompt.toolName,
				command: prompt.command,
				reason: prompt.reason,
			});
			if (outcome.decision === "accept") return "Allow once";
			if (outcome.decision === "acceptForSession") return "Allow always";
			if (outcome.reason && outcome.reason !== NO_SUBSCRIBER_REASON && outcome.reason !== CANCEL_REASON) {
				pendingInput = outcome.reason;
				return "Deny with feedback";
			}
			return "Deny";
		},
		async confirm(title, message) {
			const outcome = await bridge.requestApproval(threadId, "commandExecution", {
				turnId: "turn-approval",
				itemId: "approval-confirm",
				toolName: "confirm",
				command: title,
				reason: message,
			});
			return outcome.allow;
		},
		async input() {
			const value = pendingInput;
			pendingInput = undefined;
			return value;
		},
		notify(): void {},
		onTerminalInput(): () => void {
			return () => {};
		},
		setStatus(): void {},
		setWorkingMessage(): void {},
		setWorkingVisible(): void {},
		setWorkingIndicator(): void {},
		setHiddenThinkingLabel(): void {},
		setWidget(): void {},
		setFooter(): void {},
		setHeader(): void {},
		setTitle(): void {},
		custom<T>(): Promise<T> {
			return Promise.reject(new Error("Custom UI is not available in app-server mode."));
		},
		pasteToEditor(text): void {
			editorText = text;
		},
		setEditorText(text): void {
			editorText = text;
		},
		getEditorText(): string {
			return editorText;
		},
		async editor(_title, prefill) {
			return prefill;
		},
		addAutocompleteProvider(): void {},
		setEditorComponent(factory): void {
			editorFactory = factory;
		},
		getEditorComponent() {
			return editorFactory;
		},
		theme,
		getAllThemes: getAvailableThemesWithPaths,
		getTheme(name): Theme | undefined {
			return getThemeByName(name);
		},
		setTheme(_nextTheme: string | Theme): { success: boolean; error?: string } {
			return { success: false, error: "Theme switching is not available in app-server mode." };
		},
		getToolsExpanded(): boolean {
			return toolsExpanded;
		},
		setToolsExpanded(expanded): void {
			toolsExpanded = expanded;
		},
	};
}

export function readSecretQuestionIds(params: unknown): ReadonlySet<string> {
	const questions = isRecord(params) && Array.isArray(params.questions) ? params.questions : [];
	const ids = questions.flatMap((question) => {
		if (!isRecord(question) || (question.isSecret !== true && question.is_secret !== true)) {
			return [];
		}
		const id = readString(question, "id");
		return id ? [id] : [];
	});
	return new Set(ids);
}

export function redactSecretAnswers(response: unknown, secretQuestionIds: ReadonlySet<string>): unknown {
	if (secretQuestionIds.size === 0 || !isRecord(response) || !isRecord(response.answers)) {
		return response;
	}
	const redactedAnswers: Record<string, unknown> = {};
	for (const [questionId, answer] of Object.entries(response.answers)) {
		redactedAnswers[questionId] = secretQuestionIds.has(questionId) ? redactAnswer(answer) : answer;
	}
	return { ...response, answers: redactedAnswers };
}

function buildApprovalRequest(
	threadId: string,
	requestId: RequestId,
	kind: ApprovalKind,
	payload: ApprovalPayload,
): AppServerOutboundMessage {
	const base = {
		threadId,
		turnId: payload.turnId ?? "turn-approval",
		itemId: payload.itemId ?? (kind === "commandExecution" ? "approval-command" : "approval-file-change"),
		startedAtMs: Date.now(),
	};
	if (kind === "fileChange") {
		return {
			id: requestId,
			method: "item/fileChange/requestApproval",
			params: { ...base, reason: payload.reason ?? null, grantRoot: payload.grantRoot ?? null },
		};
	}
	return {
		id: requestId,
		method: "item/commandExecution/requestApproval",
		params: {
			...base,
			approvalId: payload.approvalId ?? null,
			environmentId: payload.environmentId ?? null,
			reason: payload.reason ?? null,
			command: payload.command ?? null,
			cwd: payload.cwd ?? null,
			availableDecisions: [...APPROVAL_DECISIONS],
		},
	};
}

function decisionToOutcome(decision: ApprovalDecision, reason: string | undefined): ApprovalOutcome {
	if (decision === "accept" || decision === "acceptForSession") return { allow: true, decision };
	return reason ? { allow: false, decision, reason } : { allow: false, decision };
}

function readDecision(response: ApprovalResponse): ApprovalDecision {
	const decision = isRecord(response.result) ? response.result.decision : undefined;
	return isApprovalDecision(decision) ? decision : "cancel";
}

function readReason(response: ApprovalResponse): string | undefined {
	const resultReason = isRecord(response.result) ? (response.result.reason ?? response.result.message) : undefined;
	const errorReason = isRecord(response.error) ? response.error.message : undefined;
	const reason = typeof resultReason === "string" ? resultReason : errorReason;
	return typeof reason === "string" && reason.length > 0 ? reason : undefined;
}

function createAllowKey(threadId: string, kind: ApprovalKind, payload: ApprovalPayload): string | undefined {
	if (!payload.toolName || typeof payload.command !== "string") return undefined;
	return `${threadId}\0${kind}\0${payload.toolName}\0${payload.command}`;
}

function parsePermissionPrompt(title: string): PermissionPrompt | undefined {
	const [firstLine = "", ...rest] = title.split("\n");
	const prefix = "Permission required: ";
	if (!firstLine.startsWith(prefix)) return undefined;
	const toolName = firstLine.slice(prefix.length).trim();
	const reason = rest.join("\n").trim();
	return {
		kind: permissionKind(toolName),
		toolName,
		command:
			readLineValue(reason, "Command: $ ") ??
			readLineValue(reason, "File: ") ??
			readLineValue(reason, "Path: ") ??
			null,
		reason,
	};
}

function permissionKind(toolName: string): ApprovalKind {
	return toolName === "edit" || toolName === "write" || toolName === "apply_patch" || toolName === "multiedit"
		? "fileChange"
		: "commandExecution";
}

function readLineValue(text: string, prefix: string): string | undefined {
	return text
		.split("\n")
		.find((line) => line.startsWith(prefix))
		?.slice(prefix.length);
}

function isPermissionOptions(options: readonly string[]): boolean {
	return PERMISSION_OPTIONS.every((option) => options.includes(option));
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
	return value === "accept" || value === "acceptForSession" || value === "decline" || value === "cancel";
}

function redactAnswer(answer: unknown): unknown {
	return isRecord(answer) && Array.isArray(answer.answers)
		? { ...answer, answers: answer.answers.map(() => "[REDACTED]") }
		: answer;
}

function readString(input: Readonly<Record<string, unknown>>, key: string): string | undefined {
	const value = input[key];
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
