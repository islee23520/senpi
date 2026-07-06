import type { JsonValue, RemoteControlConnectionStatus } from "./base.ts";

export type Model = JsonValue;

export type ModelListParams = {
	readonly cursor?: string | null;
	readonly limit?: number | null;
	readonly includeHidden?: boolean | null;
};
export type ModelListResponse = { readonly data: readonly Model[]; readonly nextCursor: string | null };
export type RemoteControlStatusReadResponse = {
	readonly status: RemoteControlConnectionStatus;
	readonly serverName: string;
	readonly installationId: string;
	readonly environmentId: string | null;
};
