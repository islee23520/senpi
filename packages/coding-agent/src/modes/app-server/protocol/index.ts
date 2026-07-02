import type {
	EXPERIMENTAL_ONLY_CLIENT_REQUEST_METHODS,
	SERVER_NOTIFICATION_METHODS,
	SERVER_REQUEST_METHODS,
	STABLE_CLIENT_REQUEST_METHODS,
} from "./methods.ts";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue | undefined };
export type AbsolutePathBuf = string;
export type LegacyAppPathString = string;
export type RequestId = string | number;
export type ThreadId = string;

export type ClientInfo = { name: string; title: string | null; version: string };

export type InitializeCapabilities = {
	experimentalApi: boolean;
	requestAttestation: boolean;
	mcpServerOpenaiFormElicitation?: boolean;
	optOutNotificationMethods?: string[] | null;
};

export type InitializeParams = { clientInfo: ClientInfo; capabilities: InitializeCapabilities | null };

export type InitializeResponse = {
	userAgent: string;
	codexHome: AbsolutePathBuf;
	platformFamily: string;
	platformOs: string;
};

export type AskForApproval =
	| "untrusted"
	| "on-failure"
	| "on-request"
	| {
			granular: {
				sandbox_approval: boolean;
				rules: boolean;
				skill_approval: boolean;
				request_permissions: boolean;
				mcp_elicitations: boolean;
			};
	  }
	| "never";

export type ApprovalsReviewer = "user" | "auto_review" | "guardian_subagent";
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxPolicy =
	| { type: "dangerFullAccess" }
	| { type: "readOnly"; networkAccess: boolean }
	| { type: "externalSandbox"; networkAccess: "restricted" | "enabled" | "disabled" }
	| {
			type: "workspaceWrite";
			writableRoots: AbsolutePathBuf[];
			networkAccess: boolean;
			excludeTmpdirEnvVar: boolean;
			excludeSlashTmp: boolean;
	  };

export type Personality = string;
export type MultiAgentMode = string;
export type ReasoningEffort = string;
export type ReasoningSummary = string;
export type ServiceTier = string;
export type ThreadSource = string;
export type ThreadStartSource = string;
export type ThreadSourceKind =
	| "cli"
	| "vscode"
	| "exec"
	| "appServer"
	| "subAgent"
	| "subAgentReview"
	| "subAgentCompact"
	| "subAgentThreadSpawn"
	| "subAgentOther"
	| "unknown";
export type SessionSource = ThreadSourceKind | { custom: string } | { subAgent: JsonValue };
export type SortDirection = "asc" | "desc";
export type ThreadSortKey = "created_at" | "updated_at" | "recency_at";
export type ThreadStatus =
	| { type: "notLoaded" }
	| { type: "idle" }
	| { type: "systemError" }
	| { type: "active"; activeFlags: JsonValue[] };
export type ThreadUnsubscribeStatus = string;

export type AdditionalContextEntry = { value: string; kind: string };
export type UserInput =
	| { type: "text"; text: string; text_elements?: JsonValue[] }
	| { type: "image"; detail?: string; url: string }
	| { type: "localImage"; detail?: string; path: string }
	| { type: "skill"; name: string; path: string }
	| { type: "mention"; name: string; path: string };
export type TurnEnvironmentParams = JsonValue;
export type DynamicToolSpec = JsonValue;
export type SelectedCapabilityRoot = JsonValue;
export type ActivePermissionProfile = JsonValue;
export type TurnsPage = JsonValue;
export type Model = JsonValue;
export type RemoteControlConnectionStatus = string;
export type GitInfo = { sha: string | null; branch: string | null; originUrl: string | null };
export type Turn = {
	id: string;
	items: JsonValue[];
	itemsView: JsonValue;
	status: JsonValue;
	error: JsonValue | null;
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
};

export type Thread = {
	id: string;
	sessionId: string;
	forkedFromId: string | null;
	parentThreadId: string | null;
	preview: string;
	ephemeral: boolean;
	modelProvider: string;
	createdAt: number;
	updatedAt: number;
	recencyAt: number | null;
	status: ThreadStatus;
	path: string | null;
	cwd: AbsolutePathBuf;
	cliVersion: string;
	source: SessionSource;
	threadSource: ThreadSource | null;
	agentNickname: string | null;
	agentRole: string | null;
	gitInfo: GitInfo | null;
	name: string | null;
	turns: Turn[];
};

type ThreadRuntimeOverrides = {
	model?: string | null;
	modelProvider?: string | null;
	serviceTier?: ServiceTier | null;
	cwd?: string | null;
	runtimeWorkspaceRoots?: AbsolutePathBuf[] | null;
	approvalPolicy?: AskForApproval | null;
	approvalsReviewer?: ApprovalsReviewer | null;
	sandbox?: SandboxMode | null;
	permissions?: string | null;
	config?: { [key: string]: JsonValue | undefined } | null;
	baseInstructions?: string | null;
	developerInstructions?: string | null;
};

type ThreadRuntimeResponse = {
	thread: Thread;
	model: string;
	modelProvider: string;
	serviceTier: string | null;
	cwd: AbsolutePathBuf;
	runtimeWorkspaceRoots: AbsolutePathBuf[];
	instructionSources: LegacyAppPathString[];
	approvalPolicy: AskForApproval;
	approvalsReviewer: ApprovalsReviewer;
	sandbox: SandboxPolicy;
	activePermissionProfile: ActivePermissionProfile | null;
	reasoningEffort: ReasoningEffort | null;
	multiAgentMode: MultiAgentMode;
};

export type ThreadStartParams = ThreadRuntimeOverrides & {
	serviceName?: string | null;
	personality?: Personality | null;
	multiAgentMode?: MultiAgentMode | null;
	ephemeral?: boolean | null;
	sessionStartSource?: ThreadStartSource | null;
	threadSource?: ThreadSource | null;
	environments?: TurnEnvironmentParams[] | null;
	dynamicTools?: DynamicToolSpec[] | null;
	selectedCapabilityRoots?: SelectedCapabilityRoot[] | null;
	mockExperimentalField?: string | null;
	experimentalRawEvents?: boolean;
};

export type ThreadStartResponse = ThreadRuntimeResponse;

export type ThreadResumeParams = ThreadRuntimeOverrides & {
	threadId: ThreadId;
	history?: JsonValue[] | null;
	path?: string | null;
	personality?: Personality | null;
	excludeTurns?: boolean;
	initialTurnsPage?: JsonValue | null;
};

export type ThreadResumeResponse = ThreadRuntimeResponse & {
	initialTurnsPage: TurnsPage | null;
};

export type ThreadForkParams = ThreadRuntimeOverrides & {
	threadId: ThreadId;
	path?: string | null;
	ephemeral?: boolean;
	threadSource?: ThreadSource | null;
	excludeTurns?: boolean;
};

export type ThreadForkResponse = ThreadRuntimeResponse;

export type ThreadReadParams = { threadId: ThreadId; includeTurns?: boolean };
export type ThreadReadResponse = { thread: Thread };
export type ThreadListParams = {
	cursor?: string | null;
	limit?: number | null;
	sortKey?: ThreadSortKey | null;
	sortDirection?: SortDirection | null;
	modelProviders?: string[] | null;
	sourceKinds?: ThreadSourceKind[] | null;
	archived?: boolean | null;
	cwd?: string | string[] | null;
	useStateDbOnly?: boolean;
	searchTerm?: string | null;
	parentThreadId?: string | null;
};
export type ThreadListResponse = { data: Thread[]; nextCursor: string | null; backwardsCursor: string | null };
export type ThreadLoadedListParams = { cursor?: string | null; limit?: number | null };
export type ThreadLoadedListResponse = { data: ThreadId[]; nextCursor: string | null };
export type ThreadSetNameParams = { threadId: ThreadId; name: string };
export type ThreadSetNameResponse = Record<string, never>;
export type ThreadArchiveParams = { threadId: ThreadId };
export type ThreadArchiveResponse = Record<string, never>;
export type ThreadDeleteParams = { threadId: ThreadId };
export type ThreadDeleteResponse = Record<string, never>;
export type ThreadUnsubscribeParams = { threadId: ThreadId };
export type ThreadUnsubscribeResponse = { status: ThreadUnsubscribeStatus };

type TurnCommonParams = {
	threadId: ThreadId;
	clientUserMessageId?: string | null;
	input: UserInput[];
	responsesapiClientMetadata?: { [key: string]: string | undefined } | null;
	additionalContext?: { [key: string]: AdditionalContextEntry | undefined } | null;
};

export type TurnStartParams = TurnCommonParams & {
	environments?: TurnEnvironmentParams[] | null;
	cwd?: string | null;
	runtimeWorkspaceRoots?: AbsolutePathBuf[] | null;
	approvalPolicy?: AskForApproval | null;
	approvalsReviewer?: ApprovalsReviewer | null;
	sandboxPolicy?: SandboxPolicy | null;
	permissions?: string | null;
	model?: string | null;
	serviceTier?: ServiceTier | null;
	effort?: ReasoningEffort | null;
	summary?: ReasoningSummary | null;
	personality?: Personality | null;
	outputSchema?: JsonValue | null;
	collaborationMode?: JsonValue | null;
	multiAgentMode?: MultiAgentMode | null;
};
export type TurnStartResponse = { turn: Turn };
export type TurnSteerParams = TurnCommonParams & { expectedTurnId: string };
export type TurnSteerResponse = { turnId: string };
export type TurnInterruptParams = { threadId: ThreadId; turnId: string };
export type TurnInterruptResponse = Record<string, never>;

export type ModelListParams = { cursor?: string | null; limit?: number | null; includeHidden?: boolean | null };
export type ModelListResponse = { data: Model[]; nextCursor: string | null };
export type RemoteControlStatusReadResponse = {
	status: RemoteControlConnectionStatus;
	serverName: string;
	installationId: string;
	environmentId: string | null;
};

export type StableClientRequestMethod = (typeof STABLE_CLIENT_REQUEST_METHODS)[number];
export type ExperimentalOnlyClientRequestMethod = (typeof EXPERIMENTAL_ONLY_CLIENT_REQUEST_METHODS)[number];
export type ServerNotificationMethod = (typeof SERVER_NOTIFICATION_METHODS)[number];
export type ServerRequestMethod = (typeof SERVER_REQUEST_METHODS)[number];

export type ClientRequest =
	| { method: "initialize"; id: RequestId; params: InitializeParams }
	| { method: "model/list"; id: RequestId; params: ModelListParams }
	| { method: "thread/start"; id: RequestId; params: ThreadStartParams }
	| { method: "thread/resume"; id: RequestId; params: ThreadResumeParams }
	| { method: "thread/read"; id: RequestId; params: ThreadReadParams }
	| { method: "thread/list"; id: RequestId; params: ThreadListParams }
	| { method: "thread/loaded/list"; id: RequestId; params: ThreadLoadedListParams }
	| { method: "thread/fork"; id: RequestId; params: ThreadForkParams }
	| { method: "thread/name/set"; id: RequestId; params: ThreadSetNameParams }
	| { method: "thread/archive"; id: RequestId; params: ThreadArchiveParams }
	| { method: "thread/delete"; id: RequestId; params: ThreadDeleteParams }
	| { method: "thread/unsubscribe"; id: RequestId; params: ThreadUnsubscribeParams }
	| { method: "turn/start"; id: RequestId; params: TurnStartParams }
	| { method: "turn/steer"; id: RequestId; params: TurnSteerParams }
	| { method: "turn/interrupt"; id: RequestId; params: TurnInterruptParams };

export type ServerNotification = { method: ServerNotificationMethod; params?: JsonValue };
export type ServerRequest = { method: ServerRequestMethod; id: RequestId; params?: JsonValue };
