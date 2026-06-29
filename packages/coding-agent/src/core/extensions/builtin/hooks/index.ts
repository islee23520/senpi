export { parseHookConfig } from "./schema.ts";
export type {
	CommandHookConfig,
	ExecutableHookHandler,
	HookDiagnostic,
	HookDiagnosticCode,
	HookInputWire,
	HookOutputWire,
	HookRuntimeState,
	HookSourceMetadata,
	HookTrustEntry,
	HookTrustState,
	ParsedHookConfig,
	SupportedHookEvent,
	UnsupportedKnownHookEvent,
} from "./types.ts";
export {
	SUPPORTED_HOOK_EVENTS,
	UNSUPPORTED_HANDLER_TYPES,
	UNSUPPORTED_KNOWN_HOOK_EVENTS,
} from "./types.ts";
