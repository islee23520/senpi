export function buildParallelToolsSection(): string {
	return `## Parallel Tool Calls

When tool calls are independent, fire them in one wave in the same response - reads, searches, listings, diagnostics. Bias hard toward parallel exploration when context is thin: pull in anything even loosely relevant now instead of serially later. Wasted reads cost almost nothing; acting on stale assumptions costs the whole turn.

Sequence calls only when one needs a value another produced. Never fill missing parameters with placeholders.`;
}
