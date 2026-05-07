import type { Api } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "../../types.js";

type ToolDefinition = Record<string, unknown>;

const NATIVE_WEB_FETCH_TYPE = "web_fetch_20260309";
const MAX_USES_ENV = "PI_ANTHROPIC_WEB_FETCH_MAX_USES";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isWebFetchType(value: unknown): value is string {
	return typeof value === "string" && value.startsWith("web_fetch_");
}

function parseMaxUses(): number | undefined {
	const envValue = process.env[MAX_USES_ENV];
	if (!envValue) {
		return undefined;
	}

	const parsed = Number.parseInt(envValue, 10);
	if (Number.isNaN(parsed) || parsed <= 0) {
		return undefined;
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
		const stripLegacyWebfetch = name === "webfetch" && !isWebFetchType(type);
		const stripUnderscoreFunction = name === "web_fetch" && !isWebFetchType(type);
		if (!stripLegacyWebfetch && !stripUnderscoreFunction) {
			sanitized.push(tool);
		}
	}

	return sanitized;
}

function createNativeWebFetchTool(): ToolDefinition {
	const maxUses = parseMaxUses();
	if (maxUses === undefined) {
		return {
			type: NATIVE_WEB_FETCH_TYPE,
			name: "web_fetch",
		};
	}

	return {
		type: NATIVE_WEB_FETCH_TYPE,
		name: "web_fetch",
		max_uses: maxUses,
	};
}

export function addAnthropicWebFetchToPayload(api: Api | undefined, payload: unknown): unknown {
	if (api !== "anthropic-messages") {
		return payload;
	}

	if (!isRecord(payload)) {
		return payload;
	}

	const tools = Array.isArray(payload.tools) ? payload.tools : [];
	const sanitizedTools = sanitizeTools(tools);
	const hasNativeWebFetch = sanitizedTools.some((tool) => isWebFetchType(tool.type));
	if (!hasNativeWebFetch) {
		sanitizedTools.push(createNativeWebFetchTool());
	}

	return {
		...payload,
		tools: sanitizedTools,
	};
}

export const ANTHROPIC_WEB_FETCH_SECTION = `
## Web Fetch

The native web_fetch tool is available in this session.
Use web_fetch to retrieve content from a URL when needed.
`;

export default function anthropicWebFetchExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event, ctx) => {
		return addAnthropicWebFetchToPayload(ctx.model?.api, event.payload);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (ctx.model?.api !== "anthropic-messages") {
			return undefined;
		}

		return {
			systemPrompt: `${event.systemPrompt}\n${ANTHROPIC_WEB_FETCH_SECTION}`,
		};
	});
}
