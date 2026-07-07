import type { Api, AssistantMessage, Model, SimpleStreamOptions, TextContent } from "@earendil-works/pi-ai/compat";
import { completeSimple } from "@earendil-works/pi-ai/compat";

interface SessionTitleAuth {
	readonly apiKey: string;
	readonly headers?: Record<string, string>;
	readonly extraBody?: Record<string, unknown>;
	readonly env?: Record<string, string>;
}

interface GenerateSessionTitleOptions {
	readonly firstPrompt: string;
	readonly model: Model<Api>;
	readonly auth: SessionTitleAuth;
	readonly sessionId: string;
}

const TITLE_SYSTEM_PROMPT = `Generate a concise title for this coding-agent session.

Rules:
- Use 3 to 6 words.
- Prefer concrete nouns and verbs from the user's task.
- Do not include quotes, punctuation at the end, markdown, or explanations.
- If the input is only a greeting, acknowledgement, or too vague to title, return <title>none</title>.
- Respond only as <title>Session Title</title>.`;

const LOW_SIGNAL_PROMPTS = new Set([
	"hi",
	"hello",
	"hey",
	"yo",
	"thanks",
	"thank you",
	"ok",
	"okay",
	"k",
	"yes",
	"no",
	"yep",
	"nope",
]);

export function shouldSkipSessionTitle(text: string): boolean {
	const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
	if (normalized.length === 0) return true;
	if (normalized.startsWith("/")) return true;
	return LOW_SIGNAL_PROMPTS.has(normalized);
}

export async function generateSessionTitle(options: GenerateSessionTitleOptions): Promise<string | undefined> {
	if (shouldSkipSessionTitle(options.firstPrompt)) {
		return undefined;
	}

	const response = await completeSimple(
		options.model,
		{
			systemPrompt: TITLE_SYSTEM_PROMPT,
			messages: [
				{
					role: "user",
					content: [{ type: "text", text: options.firstPrompt }],
					timestamp: Date.now(),
				},
			],
		},
		buildTitleOptions(options),
	);
	if (response.stopReason === "error") {
		throw new Error(response.errorMessage ?? "Session title generation failed");
	}
	return parseSessionTitle(response);
}

function buildTitleOptions(options: GenerateSessionTitleOptions): SimpleStreamOptions {
	const titleOptions: SimpleStreamOptions = {
		apiKey: options.auth.apiKey,
		sessionId: options.sessionId,
		cacheRetention: options.model.cacheRetention === "none" ? "none" : "short",
		maxTokens: 64,
	};
	if (options.auth.headers !== undefined) {
		titleOptions.headers = options.auth.headers;
	}
	if (options.auth.extraBody !== undefined) {
		titleOptions.extraBody = options.auth.extraBody;
	}
	if (options.auth.env !== undefined) {
		titleOptions.env = options.auth.env;
	}
	return titleOptions;
}

function parseSessionTitle(message: AssistantMessage): string | undefined {
	const text = message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
	const match = text.match(/<title>\s*([\s\S]*?)\s*<\/title>/i);
	const rawTitle = match?.[1];
	if (rawTitle === undefined) {
		return undefined;
	}
	const title = sanitizeTitle(rawTitle);
	if (!title || title.toLowerCase() === "none") {
		return undefined;
	}
	return title;
}

function sanitizeTitle(text: string): string {
	return text
		.replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
		.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
		.replace(/\u001b[\u0020-\u002f]*[\u0030-\u007e]/g, "")
		.replace(/[\r\n]+/g, " ")
		.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/^["'`]+|["'`.!?]+$/g, "")
		.trim()
		.slice(0, 80)
		.trim();
}
