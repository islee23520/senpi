import type { InitializeParams, JsonValue, RequestId } from "./base.ts";
import type {
	EXPERIMENTAL_ONLY_CLIENT_REQUEST_METHODS,
	SERVER_NOTIFICATION_METHODS,
	SERVER_REQUEST_METHODS,
	STABLE_CLIENT_REQUEST_METHODS,
} from "./methods.ts";
import type { ModelListParams } from "./models.ts";
import type {
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
} from "./thread.ts";
import type { TurnInterruptParams, TurnStartParams, TurnSteerParams } from "./turn.ts";

export type StableClientRequestMethod = (typeof STABLE_CLIENT_REQUEST_METHODS)[number];
export type ExperimentalOnlyClientRequestMethod = (typeof EXPERIMENTAL_ONLY_CLIENT_REQUEST_METHODS)[number];
export type ServerNotificationMethod = (typeof SERVER_NOTIFICATION_METHODS)[number];
export type ServerRequestMethod = (typeof SERVER_REQUEST_METHODS)[number];

export type ClientRequest =
	| { readonly method: "initialize"; readonly id: RequestId; readonly params: InitializeParams }
	| { readonly method: "model/list"; readonly id: RequestId; readonly params: ModelListParams }
	| { readonly method: "thread/start"; readonly id: RequestId; readonly params: ThreadStartParams }
	| { readonly method: "thread/resume"; readonly id: RequestId; readonly params: ThreadResumeParams }
	| { readonly method: "thread/read"; readonly id: RequestId; readonly params: ThreadReadParams }
	| { readonly method: "thread/list"; readonly id: RequestId; readonly params: ThreadListParams }
	| { readonly method: "thread/loaded/list"; readonly id: RequestId; readonly params: ThreadLoadedListParams }
	| { readonly method: "thread/fork"; readonly id: RequestId; readonly params: ThreadForkParams }
	| { readonly method: "thread/name/set"; readonly id: RequestId; readonly params: ThreadSetNameParams }
	| { readonly method: "thread/archive"; readonly id: RequestId; readonly params: ThreadArchiveParams }
	| { readonly method: "thread/delete"; readonly id: RequestId; readonly params: ThreadDeleteParams }
	| { readonly method: "thread/unsubscribe"; readonly id: RequestId; readonly params: ThreadUnsubscribeParams }
	| { readonly method: "turn/start"; readonly id: RequestId; readonly params: TurnStartParams }
	| { readonly method: "turn/steer"; readonly id: RequestId; readonly params: TurnSteerParams }
	| { readonly method: "turn/interrupt"; readonly id: RequestId; readonly params: TurnInterruptParams };

export type ServerNotification = { readonly method: ServerNotificationMethod; readonly params?: JsonValue };
export type ServerRequest = {
	readonly method: ServerRequestMethod;
	readonly id: RequestId;
	readonly params?: JsonValue;
};
