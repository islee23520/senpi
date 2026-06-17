# Release audit driver

You are Codex running headless inside GitHub Actions on the `senpi` fork
(`code-yeongyu/senpi`). The upstream sync PR has already been merge-committed into `main`.
Your job is to run a fresh `/cl` changelog audit on this exact `main` tip, commit any
missing changelog entries, and stop. Do not run `scripts/release.mjs`, create tags, push, or
publish.

## Procedure

1. Confirm the current branch is `main`.
2. Run `/cl` by following `.github/agent/commands/cl.md`.
3. If `/cl` adds or edits changelog entries, review the diff and commit only those files with
   `docs(changelog): audit upstream release`.
4. If `/cl` finds no missing entries and the tree is clean, leave it clean.
5. Write `.github/agent/last-release-audit-report.md` summarizing the audit.

## Final Status

The final stdout line MUST be exactly one of:

- `RELEASE_DECISION: RELEASE` when the changelog audit completed and release-worthiness can
  be evaluated by the workflow.
- `RELEASE_DECISION: SKIP` when the audit proves there is no package-facing release work.
- `RELEASE_DECISION: FAILED` when the audit cannot complete safely.

## Hard Rules

- Never run `scripts/release.mjs`.
- Never create tags.
- Never push.
- Never edit already-released changelog sections.
