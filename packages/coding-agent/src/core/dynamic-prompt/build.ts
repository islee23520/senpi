import type { Skill } from "../skills.js";
import { formatSkillsForPrompt } from "../skills.js";
import { buildExplorationSection } from "./exploration.js";
import { buildIdentitySection } from "./identity.js";
import { buildIntentGate } from "./intent-gate.js";
import { buildParallelToolsSection } from "./parallel-tools.js";
import { buildPoliciesSection } from "./policies.js";
import { buildStyleSection } from "./style.js";
import { categorizeTools } from "./tool-categorization.js";
import { buildToolSection } from "./tool-section.js";
import { buildVerificationSection } from "./verification.js";

export interface BuildDynamicSystemPromptOptions {
	cwd: string;
	selectedTools: string[];
	toolSnippets: Record<string, string>;
	promptGuidelines: string[];
	contextFiles: Array<{ path: string; content: string }>;
	skills: Skill[];
	tuningSection?: string;
}

function buildContextFilesSection(contextFiles: Array<{ path: string; content: string }>): string {
	if (contextFiles.length === 0) {
		return "";
	}

	const lines = ["## Project Context", ""];
	for (const contextFile of contextFiles) {
		lines.push(`### ${contextFile.path}`, "", contextFile.content.trimEnd(), "");
	}
	return lines.join("\n").trimEnd();
}

export function buildDynamicSystemPrompt(options: BuildDynamicSystemPromptOptions): string {
	const promptCwd = options.cwd.replace(/\\/g, "/");
	const tools = categorizeTools(options.selectedTools);
	const date = new Date().toISOString().slice(0, 10);

	const sections = [
		buildIdentitySection(),
		"",
		buildIntentGate({ tools }),
		"",
		buildParallelToolsSection(),
		"",
		buildExplorationSection(),
		"",
		buildVerificationSection(),
		"",
		buildToolSection({
			tools,
			toolSnippets: options.toolSnippets,
			promptGuidelines: options.promptGuidelines,
		}),
		"",
		buildPoliciesSection(),
		"",
		buildStyleSection(),
	];

	const tuning = options.tuningSection?.trim();
	if (tuning) {
		sections.push("", tuning);
	}

	const contextFilesSection = buildContextFilesSection(options.contextFiles);
	if (contextFilesSection) {
		sections.push("", contextFilesSection);
	}

	const skillsSection = formatSkillsForPrompt(options.skills);
	if (skillsSection) {
		sections.push(skillsSection);
	}

	sections.push("", `Current date: ${date}`, `Current working directory: ${promptCwd}`);

	return sections.join("\n");
}
