export function buildVerificationSection(): string {
	return `## Verification

Tier the scope, never the rigor.

- V1 — single-file non-behavioral edits: diagnostics on that file. Done.
- V2 — single-domain behavioral edits: diagnostics on changed files in parallel, related tests, one execution of the affected runnable entry point when one exists.
- V3 — multi-file or cross-cutting work: diagnostics on every changed file, related tests, build, manual exercise of user-visible behavior through its real surface.

"Should pass" is not verification. Reporting clean output without running the validator is a violation. Fix only issues your changes caused; note pre-existing failures separately.`;
}
