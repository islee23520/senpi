# PR-006 Sanitized Evidence Addendum

This work is using code-yeongyu/lazycodex teammode.

This addendum makes the PR-006 evidence reviewable from a detached PR checkout.
Full raw artifacts remain under `local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-006-streaming/`,
which is intentionally gitignored. The excerpts below are sanitized: no raw
secret-bearing logs, env dumps, tokens, auth headers, cookies, or private
credentials are included.

## Scope

- PR: https://github.com/code-yeongyu/senpi/pull/78
- Branch: `code-yeongyu/pi-codex-app-server-stream-callback`
- Initial implementation commit: `18cea8f46b83e2caace347ac42b7c00e6a4ad28b`
- CamelCase follow-up commit: `dc956dc46e387a14cdd6178e41987f133392d2b5`

PR-006 remains limited to item and notification projection. PR-007
backpressure/lag, PR-008 callbacks, PR-009 MCP/dynamic tools, PR-010 reconnect,
redaction QA, and the final evidence packet are intentionally out of scope.

## Command Log

Commands were run from `/Users/yeongyu/local-workspaces/senpi` unless noted.

```bash
cd packages/coding-agent &&
  npx tsx ../../node_modules/vitest/dist/cli.js --run \
    test/suite/pi-codex-app-server-streaming.test.ts
```

```bash
cd packages/coding-agent &&
  npx tsx ../../node_modules/vitest/dist/cli.js --run \
    test/suite/pi-codex-app-server-streaming.test.ts \
    test/suite/pi-codex-app-server-contract.test.ts \
    test/suite/pi-codex-app-server-routing.test.ts
```

```bash
npm run check
node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check
node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test
node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test
node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --help
gh project list --owner code-yeongyu --format json --limit 20
```

CamelCase blocker follow-up additionally ran:

```bash
NODE_PATH=/Users/yeongyu/local-workspaces/senpi/node_modules \
  bun run /Users/yeongyu/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/scripts/typescript/check-no-excuse-rules.ts \
    packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/notification-projector.ts \
    packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/item-stream-projector.ts \
    packages/coding-agent/test/suite/pi-codex-app-server-streaming.test.ts
```

## Failing-First Evidence

Initial PR-006 failing-first proof showed the streaming suite could not import
the projector before implementation:

```text
FAIL test/suite/pi-codex-app-server-streaming.test.ts
Error: Cannot find module '../../src/core/extensions/builtin/pi-codex-app-server/notification-projector.ts'
Test Files 1 failed (1)
Tests no tests
```

CamelCase blocker failing-first proof showed the actual generated schema shape
lost correlation before the follow-up fix:

```text
FAIL test/suite/pi-codex-app-server-streaming.test.ts > projects generated camelCase notification ids without losing session correlation
-   "appThreadId": "app-thread-1",
-   "appTurnId": "app-turn-1",
+   "appThreadId": undefined,
+   "appTurnId": undefined,
-   "externalSessionId": "external-session-1",
+   "externalSessionId": undefined,
Test Files 1 failed (1)
Tests 1 failed | 4 passed (5)
```

## Targeted And Adjacent Tests

Original PR-006 targeted adjacent suite after implementation:

```text
RUN v4.1.9 /Users/yeongyu/local-workspaces/senpi/packages/coding-agent
Test Files 3 passed (3)
Tests 13 passed (13)
```

CamelCase follow-up final adjacent suite:

```text
RUN v4.1.9 /Users/yeongyu/local-workspaces/senpi/packages/coding-agent
Test Files 3 passed (3)
Tests 14 passed (14)
```

The added regression covers generated camelCase payload fields:
`threadId`, `turnId`, `itemId`, `requestId`, and nested `item.id`. The assertion
also verifies that `item/started` registers the app-server item in `IdMapper`.

## Full Check

Final `npm run check` after the camelCase follow-up:

```text
> check
> biome check --write --error-on-warnings . && npm run check:pinned-deps && npm run check:ts-imports && npm run check:shrinkwrap && tsgo --noEmit && node scripts/check-browser-smoke.mjs && node scripts/run-web-ui-check.mjs

Checked 1168 files in 677ms. No fixes applied.
packages/coding-agent/npm-shrinkwrap.json is up to date.
Checked 67 files in 37ms. No fixes applied.
```

The commit hook also reran `npm run check` successfully before accepting
`dc956dc46e387a14cdd6178e41987f133392d2b5`.

## senpi QA

`common.mjs --self-check`:

```text
[PASS] repo root resolves
[PASS] tsx entry present
[PASS] sandbox isolates agent + session dirs
[PASS] real auth snapshot taken
[PASS] free port allocatable
[PASS] evidence dir creatable under local-ignore
[PASS] ansi stripping
[PASS] sandbox removed on cleanup
[PASS] real auth unchanged
common.mjs --self-check: 9/9 passed
```

`cli-smoke.mjs --self-test`:

```text
[PASS] --help prints usage with flags
[PASS] --version prints a version
[PASS] --list-models lists built-in models offline (no API)
[PASS] unknown option is reported, not silently ignored
[PASS] real auth unchanged
cli-smoke.mjs --self-test: 5/5 passed
```

`mock-loop.mjs --self-test`:

```text
[PASS] openai-completions: baseUrl override round-trips through the real loop
[PASS] anthropic-messages: baseUrl override round-trips through the real loop
[PASS] openai-responses: baseUrl override round-trips through the real loop
[PASS] zero real provider calls (only localhost fake hit)
[PASS] real auth unchanged
mock-loop.mjs --self-test: 5/5 passed
```

## Adapter Harness Smoke

The PR-004 adapter harness help surface was smoke-tested to verify the checked-in
manual QA helper remains invokable:

```text
pi-codex-app-server adapter harness
Usage:
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --help
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-stdio --app-server-command <path> [--app-server-args <args>]
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-websocket <url>
  node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --external-unix <sock> --app-server-command <path>
Status:
  PR-004 runtime smoke only. Protocol routing, streaming, callbacks, reconnect,
  redaction, and final evidence packet generation are intentionally deferred.
```

## Static Audit And File Size

The TypeScript no-excuse audit passed on the camelCase follow-up files:

```text
No violations in 3 file(s).
```

Pure non-comment LOC after the follow-up:

```text
notification-projector.ts: 150
item-stream-projector.ts: 155
pi-codex-app-server-streaming.test.ts: 248
```

## Project Tracking

GitHub Project tracking remains blocked by token scope, which does not block code
PR creation:

```text
error: your authentication token is missing required scopes [read:project]
To request it, run: gh auth refresh -s read:project
```

Recorded status: `BLOCKED:missing-gh-project-scope`.

## Cleanup Receipt

Cleanup evidence was regenerated with process arguments omitted for secret
safety:

```text
Cleanup receipt for PR-006 camelCase projection follow-up
QA/test commands completed with no intentionally retained senpi adapter processes, sockets, or tmux sessions.
Relevant process-name check, command arguments omitted for secret safety:
tmux sessions:
```

The senpi QA scripts also reported the real auth file unchanged.

## Current Residual Risks

- Live Codex app-server streaming scenarios `07` and `13` are not fully driven
  through a protocol route in PR-006; this PR proves projection behavior and
  keeps harness health green.
- Backpressure, lag markers, overload drop accounting, and terminal flush
  guarantees remain PR-007.
- Server-request callbacks, callback cleanup, and no-auto-approval behavior
  remain PR-008.
- MCP/dynamic tool callback compatibility remains PR-009.
