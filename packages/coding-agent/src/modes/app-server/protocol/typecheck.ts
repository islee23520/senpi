import type {
	InitializeParams,
	ThreadArchiveParams,
	ThreadDeleteParams,
	ThreadForkParams,
	ThreadListParams,
	ThreadLoadedListParams,
	ThreadReadParams,
	ThreadResumeParams,
	ThreadSetNameParams,
	ThreadStartParams,
	ThreadUnsubscribeParams,
	TurnInterruptParams,
	TurnStartParams,
	TurnSteerParams,
} from "./index.ts";

const initializeParams: InitializeParams = {
	clientInfo: {
		name: "senpi",
		title: null,
		version: "0.0.0",
	},
	capabilities: {
		experimentalApi: true,
		requestAttestation: false,
	},
};

const threadStartParams: ThreadStartParams = {};
const threadResumeParams: ThreadResumeParams = { threadId: "thread-1" };
const threadReadParams: ThreadReadParams = { threadId: "thread-1", includeTurns: true };
const threadListParams: ThreadListParams = {};
const threadLoadedListParams: ThreadLoadedListParams = {};
const threadForkParams: ThreadForkParams = { threadId: "thread-1" };
const threadSetNameParams: ThreadSetNameParams = { threadId: "thread-1", name: "name" };
const threadArchiveParams: ThreadArchiveParams = { threadId: "thread-1" };
const threadDeleteParams: ThreadDeleteParams = { threadId: "thread-1" };
const threadUnsubscribeParams: ThreadUnsubscribeParams = { threadId: "thread-1" };
const turnStartParams: TurnStartParams = { threadId: "thread-1", input: [] };
const turnSteerParams: TurnSteerParams = { threadId: "thread-1", input: [], expectedTurnId: "turn-1" };
const turnInterruptParams: TurnInterruptParams = { threadId: "thread-1", turnId: "turn-1" };

void initializeParams;
void threadStartParams;
void threadResumeParams;
void threadReadParams;
void threadListParams;
void threadLoadedListParams;
void threadForkParams;
void threadSetNameParams;
void threadArchiveParams;
void threadDeleteParams;
void threadUnsubscribeParams;
void turnStartParams;
void turnSteerParams;
void turnInterruptParams;
