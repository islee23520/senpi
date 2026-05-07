import type { Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "../../types.js";

type ToolDefinition = Record<string, unknown>;

const OPENAI_RESPONSES_APIS: ReadonlySet<Api> = new Set(["openai-responses", "azure-openai-responses"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isOpenAiResponsesApi(api: Api | undefined): api is "openai-responses" | "azure-openai-responses" {
	return api !== undefined && OPENAI_RESPONSES_APIS.has(api);
}

function isNativeOpenAiWebSearchType(value: unknown): value is "web_search" | "web_search_preview" {
	return value === "web_search" || value === "web_search_preview";
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitized: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		const shouldStripFunctionVariant = tool.name === "web_search" && !isNativeOpenAiWebSearchType(tool.type);
		if (!shouldStripFunctionVariant) {
			sanitized.push(tool);
		}
	}

	return sanitized;
}

export function addOpenAiWebSearchToPayload(api: Api | undefined, payload: unknown): unknown {
	if (!isOpenAiResponsesApi(api)) {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeWebSearch = sanitizedTools.some((tool) => isNativeOpenAiWebSearchType(tool.type));

	if (!hasNativeWebSearch) {
		// Verified in openai/openai-node src/resources/responses/responses.ts (2026-05-07):
		// GA discriminator includes type: "web_search" (preview variants also exist).
		sanitizedTools.push({ type: "web_search" });
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export const OPENAI_WEB_SEARCH_SECTION = `
## Web Search

The native web_search tool is available in this session.
Use web_search when the user asks for current or online information.
Prefer web_search over guessing when freshness matters.
`;

export default function openaiWebSearchExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addOpenAiWebSearchToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isOpenAiResponsesApi(ctx.model?.api)) {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${OPENAI_WEB_SEARCH_SECTION}`,
		};
	});
}
