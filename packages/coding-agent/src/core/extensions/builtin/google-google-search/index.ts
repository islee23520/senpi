import type { Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "../../types.js";

type ToolDefinition = Record<string, unknown>;

const ENABLE_ENV = "PI_GOOGLE_GOOGLE_SEARCH";

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

export function addGoogleGoogleSearchToPayload(api: Api | undefined, payload: unknown): unknown {
	if (!isGoogleApi(api)) {
		return payload;
	}

	if (!isGoogleGoogleSearchEnabled()) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);

	// Google function tools use `functionDeclarations`, not a `googleSearch` key,
	// so there is no function-tool name conflict to deduplicate here.
	const hasGoogleSearch = sanitizedTools.some((tool) => "googleSearch" in tool);
	if (!hasGoogleSearch) {
		sanitizedTools.push({ googleSearch: {} });
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export function isGoogleGoogleSearchEnabled(): boolean {
	return parseEnableEnv(ENABLE_ENV);
}

export const GOOGLE_GOOGLE_SEARCH_SECTION = `
## Google Search

The native google_search tool is available in this session. The model
queries Google for current information and grounds responses in real
search results. Prefer google_search when the user asks for current
or online information.
`;

export default function googleGoogleSearchExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addGoogleGoogleSearchToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isGoogleApi(ctx.model?.api)) {
			return undefined;
		}

		if (!isGoogleGoogleSearchEnabled()) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${GOOGLE_GOOGLE_SEARCH_SECTION}`,
		};
	});
}
