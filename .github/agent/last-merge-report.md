# Upstream Merge Report

## Upstream

- Repository: badlogic/pi-mono
- Release tag: v0.80.1
- Merged upstream main: e00074358dd7626a9526f0240998f659d856ee39
- Upstream pin: `.github/upstream.json` records tag `v0.80.1`, sha `e00074358dd7626a9526f0240998f659d856ee39`, synced_at `2026-06-23T19:07:32Z`

## Branch Commits

- `7936d1daa` sync: merge upstream v0.80.1
- `c40b842ee` docs(changelog): audit upstream e000743
- `232c2bbe0` fix(ai): restore fork provider compatibility
- This report commit records the final merge and QA evidence summary.

The merge was history-preserving. No rebase, force-push, tag, release, pull request creation, or pull request merge was performed.

## Preserved Fork Work

Existing fork history remained reachable on the bot branch, including prior senpi runtime work for provider-native tools, apply_patch handling, compaction extensions, QA automation, permission presets, browser-shaped webfetch requests, and PR evidence requirements.

Fork-specific behavior preserved during the compatibility fix:

- Existing `@earendil-works/pi-ai/compat` callers continue to get the pre-Models global dispatch surface.
- The root `@earendil-works/pi-ai` entrypoint stays side-effect-free after upstream's Models runtime migration.
- Lazy provider alias exports remain available for fork callers that still use old provider paths.
- Faux providers can shadow builtin API ids in tests, including `openai-responses` and `anthropic-messages`.
- Coding-agent and web-ui source mappings keep a single pi-ai source identity during workspace tests.
- Fork compaction and extension hooks continue to use the restored compatibility stream path.

## Conflicts And Resolutions

The upstream merge introduced a large provider/runtime layout change. The follow-up compatibility commit resolved the resulting source and test breakage semantically rather than reverting upstream:

- Reconciled upstream's `src/api/*` provider split with fork provider behavior for Anthropic, Google, Vertex, Mistral, Bedrock, OpenAI completions, and OpenAI Responses.
- Restored the compat dispatcher, provider registry, generated catalog reads, env API-key injection, image exports, and faux-provider override behavior expected by fork runtime and tests.
- Kept generated model catalog changes out of hand edits; generator-side normalization was updated instead.
- Updated tests and workspace path mappings for the new root/compat split.
- Preserved fork-only builtin extension behavior under `packages/coding-agent/src/core/extensions/builtin`.

No unresolved conflicts remain.

## Changelog Audit

Command source followed: `.github/agent/commands/cl.md`.

Entries added under `## [Unreleased]`:

- `packages/agent/CHANGELOG.md`: inherited harness Models integration and session-name normalization fix.
- `packages/ai/CHANGELOG.md`: Models runtime, provider/API layout changes, auth/env/provider fixes, and legacy raw API subpath removal.
- `packages/coding-agent/CHANGELOG.md`: inherited Models runtime support and related auth/session/extension fixes.
- `packages/tui/CHANGELOG.md`: inherited tall-dialog redraw-loop revert state from v0.80.1.

Already-released changelog sections were not edited.

## QA

Repository gates from repo root:

- `npm run build`: passed.
- `npm run check`: passed with no warnings and no formatter changes.
- `npm test`: passed.
- `node packages/coding-agent/dist/cli.js --version`: passed, printed `2026.6.22`.
- `node packages/coding-agent/dist/cli.js --help`: passed, printed CLI usage.

Focused regression rerun before full gates:

- `cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/suite/gpt-apply-patch-extension.test.ts test/suite/regressions/0000-anthropic-partial-thinking-replay.test.ts`: passed, 17 tests.

senpi-qa evidence:

- `node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check`: passed, evidence `local-ignore/qa-evidence/20260623-upstream-v0.80.1/common-self-check.txt`.
- `node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test --evidence upstream-agent-mock-loop`: passed, evidence `local-ignore/qa-evidence/20260623-upstream-v0.80.1/mock-loop-self-test.txt`.
- `node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test`: passed, evidence `local-ignore/qa-evidence/20260623-upstream-v0.80.1/cli-smoke-self-test.txt`.
- `node .agents/skills/senpi-qa/scripts/tui-smoke.mjs --self-test --driver tmux --evidence upstream-agent-tui`: passed, evidence `local-ignore/qa-evidence/20260623-upstream-v0.80.1/tui-smoke-self-test.txt` and `local-ignore/qa-evidence/20260623-upstream-agent-tui/tui-smoke-tmux.txt`.

All senpi-qa channels reported the real auth file unchanged.

## Result

The bot branch is PR-ready for review.
