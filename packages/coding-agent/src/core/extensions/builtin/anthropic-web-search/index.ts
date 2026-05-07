import type { Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "../../types.js";

type ToolDefinition = Record<string, unknown>;

const DEFAULT_MAX_USES = 5;
const MAX_USES_ENV = "PI_ANTHROPIC_WEB_SEARCH_MAX_USES";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isWebSearchType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("web_search_");
}

function getMaxUses(): number {
	const envValue = process.env[MAX_USES_ENV];
	if (!envValue) {
		return DEFAULT_MAX_USES;
	}

	const parsed = Number.parseInt(envValue, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return DEFAULT_MAX_USES;
	}

	return parsed;
}

function sanitizeTools(tools: unknown[]): ToolDefinition[] {
	const sanitized: ToolDefinition[] = [];
	for (const tool of tools) {
		if (!isRecord(tool)) {
			continue;
		}

		const name = tool.name;
		const type = tool.type;
		const shouldStripFunctionVariant = name === "web_search" && !isWebSearchType(type);
		if (!shouldStripFunctionVariant) {
			sanitized.push(tool);
		}
	}
	return sanitized;
}

export function addAnthropicWebSearchToPayload(api: Api | undefined, payload: unknown): unknown {
	if (api !== "anthropic-messages") {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeWebSearch = sanitizedTools.some((tool) => isWebSearchType(tool.type));
	if (!hasNativeWebSearch) {
		sanitizedTools.push({
			type: "web_search_20250305",
			name: "web_search",
			max_uses: getMaxUses(),
		});
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export const ANTHROPIC_WEB_SEARCH_SECTION = `
## Web Search

The native web_search tool is available in this session.
Use web_search when the user asks for current or online information.
Prefer web_search over guessing when freshness matters.
`;

export default function anthropicWebSearchExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addAnthropicWebSearchToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${ANTHROPIC_WEB_SEARCH_SECTION}`,
		};
	});
}
