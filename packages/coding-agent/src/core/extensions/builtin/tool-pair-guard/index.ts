import type { ExtensionAPI } from "../../types.js";
import { sanitizeAnthropicPayload } from "./sanitize-anthropic-payload.js";
import { sanitizeOpenAIResponsesPayload } from "./sanitize-openai-responses-payload.js";

/** Guards provider requests by keeping tool-call/result pairs balanced. */
export default function toolPairGuardExtension(pi: ExtensionAPI): void {
	pi.on("before_provider_request", (event) => {
		const sanitizedAnthropicPayload = sanitizeAnthropicPayload(event.payload);
		const sanitizedPayload = sanitizeOpenAIResponsesPayload(sanitizedAnthropicPayload);
		if (sanitizedPayload === event.payload) return undefined;
		return sanitizedPayload;
	});
}
