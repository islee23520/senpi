import type { Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "../../types.js";

type ToolDefinition = Record<string, unknown>;

const ENABLE_ENV = "PI_GOOGLE_URL_CONTEXT";

function parseEnableEnv(envVar: string): boolean {
	const envValue = process.env[envVar];
	if (!envValue) {
		return true;
	}

	const normalized = envValue.trim().toLowerCase();
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}

	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}

	// Unknown values fall back to default-on behavior.
	return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isGoogleApi(api: Api | undefined): api is "google-generative-ai" | "google-vertex" {
	return api === "google-generative-ai" || api === "google-vertex";
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitizedTools: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		sanitizedTools.push(tool);
	}
	return sanitizedTools;
}

export function addGoogleUrlContextToPayload(api: Api | undefined, payload: unknown): unknown {
	if (!isGoogleApi(api)) {
		return payload;
	}

	if (!isGoogleUrlContextEnabled()) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);

	// Google function tools use `functionDeclarations`, not a `urlContext` key,
	// so there is no function-tool name conflict to deduplicate here.
	const hasUrlContext = sanitizedTools.some((tool) => "urlContext" in tool);
	if (!hasUrlContext) {
		sanitizedTools.push({ urlContext: {} });
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export function isGoogleUrlContextEnabled(): boolean {
	return parseEnableEnv(ENABLE_ENV);
}

export const GOOGLE_URL_CONTEXT_SECTION = `
## URL Context

The native url_context tool is available in this session. The model
fetches and grounds responses in URL contents. Prefer url_context
when the user references specific URLs they want analyzed.
`;

export default function googleUrlContextExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addGoogleUrlContextToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isGoogleApi(ctx.model?.api)) {
			return undefined;
		}

		if (!isGoogleUrlContextEnabled()) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${GOOGLE_URL_CONTEXT_SECTION}`,
		};
	});
}
