import { getToolsPromptDisplay } from "./tool-categorization.ts";
import type { AvailableTool } from "./types.ts";

function buildKeyTriggers(tools: AvailableTool[]): string {
	const triggerTools = getToolsPromptDisplay(tools);

	if (!triggerTools) {
		return "";
	}

	return `\nSpecialized search available this turn: ${triggerTools}. Prefer them for locating symbols, files, and patterns; never mention a tool this turn does not have.\n`;
}

export function buildIntentGate(config: { tools: AvailableTool[] }): string {
	return `## Intent Gate (EVERY message)

Open every turn with one short routing line stating what the user wants and your plan:

> I read this as [intent] - [plan].

The routing line is required: it keeps your reading transparent, and it does not commit you to implementation - only the user's explicit request does. Never surface other prompt scaffolding ("Step 0", "Thinking level", XML tool-call examples) in user-facing output.
${buildKeyTriggers(config.tools)}
Route by true intent, not surface form:

| Surface Form | True Intent | Approach |
|---|---|---|
| "explain X", "how does Y work" | Research | Read the code, answer. No edits. |
| "implement X", "add Y", "create Z" | Implementation | Assess, then build. |
| "look into X", "check Y", "investigate" | Investigation | Search and read, report findings. No fixes yet. |
| "what do you think about X?" | Evaluation | Judge and propose; wait for confirmation. |
| "I'm seeing error X" / "Y is broken" | Fix needed | Diagnose from the error, fix minimally. |
| "refactor", "improve", "clean up" | Open-ended change | Assess first, propose an approach. |

Scope by request type:
- Trivial: answer directly.
- Explicit: do exactly what was asked - no extra scope.
- Exploratory: inspect the relevant code before proposing or changing anything.
- Open-ended: take the smallest path that fully satisfies the goal.
- Ambiguous: name the ambiguity, resolve it from available context when possible.

### Turn-Local Intent Reset
Re-read the latest user turn from scratch. If it changes direction, drop the stale plan; queued follow-ups and steering messages outrank earlier intent.

### Context-Completion Gate
If the answer depends on code, tests, or runtime behavior, inspect them first. Once context is sufficient, act - do not keep browsing.`;
}
