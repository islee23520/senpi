# Upstream Merge Report

Generated: 2026-06-22T12:35:29Z

## Result

- Result: clean PR-ready branch
- Current branch: `automation/upstream-v0.79.10-27951391177`
- Current head: `ae77f4edc`
- Upstream release tag: `v0.79.10`
- Merged upstream main: `3b5613469470d2369784a0b49394c74b9c5355dd`
- Merge commit: `ba9f2cb78 Merge upstream/main into automation/upstream-v0.79.10`
- Upstream pin updated in `.github/upstream.json`:
  - `tag`: `v0.79.10`
  - `sha`: `3b5613469470d2369784a0b49394c74b9c5355dd`
  - `synced_at`: `2026-06-22T12:15:21Z`

## Preserved Fork History And Behavior

- Preserved fork package identity and CLI metadata where the fork intentionally diverges, including `@code-yeongyu/senpi`, `.senpi`, and the `senpi` bin.
- Preserved recent fork fixes from `main`, including:
  - `1a9deb72c fix(coding-agent): patch gondolin undici audit finding`
  - `feedcb8fe feat(coding-agent): clean webfetch HTML with reader mode`
  - `c65bb15a9 fix(coding-agent): stop goal continuation after tool aborts`
  - `b88c37e95 fix(coding-agent): list full catalog in model command`
- Preserved fork-specific compaction behavior in `packages/coding-agent/src/core/agent-session.ts` while adopting upstream extension compaction event metadata.
- Preserved fork provider/model behavior while adopting upstream reasoning-detail streaming and OpenCode Go GLM-5.2 xhigh metadata.

## Conflict Resolution

- `package-lock.json`: used the fork lockfile as the seed because the upstream lock referenced an invalid local package path for this checkout, then regenerated with `npm install --package-lock-only --ignore-scripts`.
- `packages/coding-agent/npm-shrinkwrap.json`: regenerated with `node scripts/generate-coding-agent-shrinkwrap.mjs`.
- Changelogs: kept fork `2026.6.21` sections, inserted upstream `0.79.10`, and preserved unreleased fork notes.
- Provider files: semantically merged fork `xhigh` support with upstream `reasoning_details` preservation.
- `packages/coding-agent/src/core/agent-session.ts`: kept the fork shared compaction execution path and added upstream `reason` / `willRetry` event typing.
- Package metadata/docs: preserved fork-specific names and configuration while accepting upstream removal of temporary selective base entrypoints where applicable.

## Commits Added After Merge

- `3c3b81bf5 docs(changelog): audit upstream 3b56134`
- `579811266 fix(coding-agent): resolve upstream compaction event typing`
- `ae77f4edc fix(ai): preserve Xiaomi reasoning compat`

## Changelog Audit

Ran the changelog audit procedure from `.github/agent/commands/cl.md`.

Added entries under `## [Unreleased]`:

- `packages/agent/CHANGELOG.md`
  - Removed the temporary `@earendil-works/pi-agent-core/base` entrypoint and selective provider-registration surface.
- `packages/ai/CHANGELOG.md`
  - Removed the temporary `@earendil-works/pi-ai/base` entrypoint and direct provider self-registration exports.
- `packages/coding-agent/CHANGELOG.md`
  - Added reader-mode cleanup for webfetch HTML extraction.
  - Fixed inherited OpenCode Go GLM-5.2 metadata to expose `xhigh` reasoning and send `reasoning_effort: "max"`.

No already released changelog sections were edited by the audit commit.

## QA

Required root gates:

- `npm run build`: passed
- `npm run check`: passed with no formatter changes
- `npm test`: passed
  - `packages/agent`: 16 files, 174 tests passed
  - `packages/ai`: 82 files passed, 25 skipped; 579 tests passed, 726 skipped
  - `packages/coding-agent`: 257 files passed, 5 skipped; 2616 tests passed, 45 skipped
  - `packages/tui`: 742 tests passed

Built CLI smoke:

- `node packages/coding-agent/dist/cli.js --version`: passed, printed `2026.6.21`
- `node packages/coding-agent/dist/cli.js --help`: passed, printed usage

senpi QA evidence:

- `node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check`: passed, evidence captured at `local-ignore/qa-evidence/20260622-upstream-self-tests/common-self-check.txt`
- `node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test --evidence upstream-agent-mock-loop`: passed, evidence captured at `local-ignore/qa-evidence/20260622-upstream-self-tests/mock-loop-self-test.txt`
- `node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test`: passed, evidence captured at `local-ignore/qa-evidence/20260622-upstream-self-tests/cli-smoke-self-test.txt`
- `node .agents/skills/senpi-qa/scripts/tui-smoke.mjs --self-test --driver tmux --evidence upstream-agent-tui`: passed, evidence captured at `local-ignore/qa-evidence/20260622-upstream-self-tests/tui-smoke-self-test.txt` and `local-ignore/qa-evidence/20260622-upstream-agent-tui/tui-smoke-tmux.txt`

All senpi QA self-tests confirmed the real auth file was unchanged.
