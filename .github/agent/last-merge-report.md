# Upstream Merge Report

## Result

- Result: clean PR-ready merge
- Upstream repo: `badlogic/pi-mono`
- Upstream tag: `v0.80.2`
- Upstream main SHA: `ec6311beb5b24fc918e5031173608447582d7262`
- Merge commit: `4aa01a11dca18c5acff4bb30a0e60bf93014cc95`
- Changelog audit commit: `74f8964b3355afad1911c7237170250f033f2db4`
- Upstream pin: `.github/upstream.json` updated to `v0.80.2` / `ec6311b`

## Preserved Fork State

- Pre-merge fork head preserved as first parent: `6f4f1b1960631457e798f830ab05aaea7454e014`.
- Recent fork-side commits preserved after `v2026.6.23`:
  - `6f4f1b196` Add `[Unreleased]` section for next cycle
  - `b37762343` Type name change
  - `c3cfeac04` fix(coding-agent): make release publication transactional
  - `6184307c` fix(ai): require explicit anthropic compat metadata
- No rebase, force-push, tag creation, release run, PR creation, or PR merge was performed.

## Conflicts Resolved

- `package-lock.json`: took upstream first as requested, then `npm install --package-lock-only --ignore-scripts` failed because the upstream lock names the coding-agent workspace as `@earendil-works/pi-coding-agent` while this fork's manifest is `@code-yeongyu/senpi`. Restored the fork lock content and regenerated it from the resolved fork manifests with `npm install --package-lock-only --ignore-scripts`.
- Package manifests:
  - Kept fork package identity, CalVer versions, `private` flags, `senpi` binary alias, direct dependency additions, and Node 24 engine policy.
  - Preserved upstream non-conflicting package updates already merged elsewhere.
- `packages/coding-agent/npm-shrinkwrap.json`: regenerated with `node scripts/generate-coding-agent-shrinkwrap.mjs`.
- Changelogs:
  - Kept fork changelog structure and released sections immutable.
  - Added missing upstream `v0.80.2` product-facing entries under current `## [Unreleased]`.
- `packages/ai/src/api/anthropic-messages.ts`:
  - Preserved fork compatibility defaults for Fireworks, Cloudflare AI Gateway Anthropic routing, Xiaomi disabled-thinking handling, tool-choice compatibility, and forced-tool-choice behavior.
- `packages/ai/src/api/openai-completions.ts`:
  - Preserved fork resolved compatibility fields for `supportsDisabledThinking`, `toolCallFormat`, and detected `openRouterRouting`.

## Changelog Audit

- `packages/agent/CHANGELOG.md`
  - Added `Changed`: public harness shell execution options type rename from `ExecutionEnvExecOptions` to `ShellExecOptions`.
- `packages/ai/CHANGELOG.md`
  - Added `Changed`: `ApiKeyCredential` discriminator/env shape.
  - Added `Fixed`: explicit Anthropic custom-model compat metadata, request-scoped auth/env resolution, legacy compat stream aliases, and `detectCompat` fallback.
- `packages/coding-agent/CHANGELOG.md`
  - Added inherited `Changed` and `Fixed` entries for the agent-core and pi-ai changes that affect the user-facing CLI package.
- `packages/tui/CHANGELOG.md` and `packages/web-ui/CHANGELOG.md`
  - No missing product-facing entries found for this upstream delta.

## QA Results

- `npm run build`: passed.
- `npm run check`: passed; Biome reported no fixes applied; shrinkwrap check passed.
- `npm test`: passed.
  - Agent: 16 files, 176 tests passed.
  - AI: 88 files passed, 25 skipped; 632 tests passed, 727 skipped.
  - Coding-agent: 261 files passed, 5 skipped; 2644 tests passed, 45 skipped.
  - TUI: 742 tests passed.
- Built CLI smoke:
  - `node packages/coding-agent/dist/cli/index.js --version`: expected path absent in this fork build layout.
  - Located actual entrypoint: `packages/coding-agent/dist/cli.js`.
  - `node packages/coding-agent/dist/cli.js --version`: passed, output `2026.6.23`.
  - `node packages/coding-agent/dist/cli.js --help`: passed.
- senpi QA:
  - `node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check`: passed, auth unchanged.
  - `node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test --evidence upstream-agent-mock-loop`: passed all three wire formats; auth unchanged.
  - `node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test`: passed; auth unchanged.
  - `node .agents/skills/senpi-qa/scripts/tui-smoke.mjs --self-test --driver tmux --evidence upstream-agent-tui`: passed; auth unchanged.
- Evidence paths:
  - `local-ignore/qa-evidence/upstream-agent/tool-versions.txt`
  - `local-ignore/qa-evidence/upstream-agent/secret-files.txt`
  - `local-ignore/qa-evidence/20260623-upstream-agent-tui/tui-smoke-tmux.txt`

## Secret Safety

- QA harnesses reported the real auth file unchanged.
- No raw tokens, auth headers, cookies, or credential values were written to the report.
