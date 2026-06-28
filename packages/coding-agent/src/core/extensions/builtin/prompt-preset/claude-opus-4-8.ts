import { type BuildDynamicSystemPromptOptions, buildDynamicSystemPrompt } from "../../../dynamic-prompt/build.ts";

function buildClaudeOpus48Tuning(): string {
	return `When an instruction names a scope like "every", "all", or "for each", apply it to the full set rather than the first item. When told "do X then Y", follow that exact sequence. State the scope explicitly when applying a rule broadly.

Maintain coherent state across extended multi-tool workflows without drifting from the original goal. Do not re-anchor with reminder paragraphs mid-task.

Prefer tool calls over reasoning when a tool can resolve the question directly. Do not reason past a fact you can look up.`;
}

export function buildClaudeOpus48Prompt(options: BuildDynamicSystemPromptOptions): string {
	return buildDynamicSystemPrompt({ ...options, tuningSection: buildClaudeOpus48Tuning() });
}
