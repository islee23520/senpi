# PR-007 Backpressure And Lag Semantics

This work is using code-yeongyu/lazycodex teammode.

## Summary

PR-007 adds a projection-level backpressure controller for the app-server
adapter. It keeps lossless events queued, drops only best-effort progress when
the best-effort queue is saturated, emits a `lag` marker before the next
lossless event after a drop, tracks dropped-progress accounting, flushes
terminal turns without losing lossless events, and preserves retryable
app-server overload as JSON-RPC `-32001`.

Scope is intentionally limited to PR-007. It does not implement PR-008
callbacks, PR-009 MCP/dynamic tools, PR-010 reconnect, redaction QA, or final
evidence packet generation.

## Changed Files

- `packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/stream-backpressure.ts`
- `packages/coding-agent/test/suite/pi-codex-app-server-backpressure.test.ts`
- `.omo/evidence/20260624-pi-codex-app-server-execution/pr-007-backpressure/summary.md`
- `.omo/evidence/20260624-pi-codex-app-server-execution/pr-007-backpressure/commands.md`
- `.omo/evidence/20260624-pi-codex-app-server-execution/pr-007-backpressure/cleanup-receipt.md`
- `.omo/evidence/20260624-pi-codex-app-server-execution/pr-007-backpressure/16-backpressure-lag.sanitized.jsonl`

## Evidence

Full raw artifacts remain under
`local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-007-backpressure/`.
Committed sanitized evidence is in this directory.

- Failing-first proof: `failing-first.txt` failed because `stream-backpressure.ts` did not exist.
- Focused backpressure test: `targeted-backpressure-final.txt` passed, 1 file / 3 tests.
- Adjacent app-server suite: `targeted-adjacent-suite-final.txt` passed, 5 files / 21 tests.
- Full check: `npm-run-check-final.txt` passed.
- senpi QA common self-check: `senpi-qa-common-self-check.txt` passed, 9/9.
- senpi QA CLI smoke: `senpi-qa-cli-smoke.txt` passed, 5/5.
- senpi QA mock loop: `senpi-qa-mock-loop.txt` passed, 5/5.
- Adapter harness help smoke: `drive-adapter-help.txt` printed the adapter harness usage.
- Strict audit: `no-excuse-audit.txt` reported no violations in 2 files.
- Scenario 16 artifact: `16-backpressure-lag.sanitized.jsonl`.
- Cleanup receipt: `cleanup-receipt.md`.

## Safe Output Excerpts

Failing-first proof:

```text
FAIL test/suite/pi-codex-app-server-backpressure.test.ts
Error: Cannot find module '../../src/core/extensions/builtin/pi-codex-app-server/stream-backpressure.ts'
Test Files 1 failed (1)
Tests no tests
```

Focused test after implementation:

```text
Test Files 1 passed (1)
Tests 3 passed (3)
```

Adjacent app-server suite:

```text
Test Files 5 passed (5)
Tests 21 passed (21)
```

Full check:

```text
Checked 1170 files in 858ms. No fixes applied.
packages/coding-agent/npm-shrinkwrap.json is up to date.
Checked 67 files in 33ms. No fixes applied.
```

senpi QA:

```text
common.mjs --self-check: 9/9 passed
cli-smoke.mjs --self-test: 5/5 passed
mock-loop.mjs --self-test: 5/5 passed
```

Static audit and file size:

```text
No violations in 2 file(s).
stream-backpressure.ts: 122 pure LOC
pi-codex-app-server-backpressure.test.ts: 76 pure LOC
```

## Assertions Covered

- Lossless events are not dropped under best-effort pressure.
- Best-effort progress drops increment dropped-progress accounting.
- A `lag` event appears before the next lossless event after best-effort drops.
- The `lag` event consumes its own monotonic adapter sequence; `nextLosslessSequence` points to the following lossless event.
- Terminal flush drains queued progress and lossless turn completion.
- App-server overload is preserved as retryable JSON-RPC `-32001`.

## Review Follow-Up: Lag Marker Sequence

The review blocker at PR #79 identified that the original lag marker reused the
following lossless event sequence. The follow-up regression now fails if emitted
sequences are duplicate or non-monotonic. Red output before the fix showed:

```text
expected [ 1, 2, 4, 4 ] to deeply equal [ 1, 2, 3, 4 ]
```

After the fix, the lag marker uses the last dropped progress event's consumed
adapter sequence, while `nextLosslessSequence` still points to the following
lossless event. Refreshed artifacts:

- `followup-lag-sequence-failing-first.txt`: failed with duplicate sequence `[1, 2, 4, 4]`.
- `followup-lag-sequence-targeted-final.txt`: 1 file / 3 tests passed.
- `followup-lag-sequence-adjacent-final.txt`: 5 files / 21 tests passed.
- `followup-lag-sequence-npm-run-check-final.txt`: `npm run check` passed.
- `followup-lag-sequence-senpi-qa-common-self-check.txt`: 9/9 passed.
- `followup-lag-sequence-senpi-qa-cli-smoke.txt`: 5/5 passed.
- `followup-lag-sequence-senpi-qa-mock-loop.txt`: 5/5 passed.
- `followup-lag-sequence-drive-adapter-help.txt`: adapter harness help rendered.

## Project Tracking

`BLOCKED:missing-gh-project-scope` remains. `gh project list --owner
code-yeongyu --format json --limit 20` still fails because the token lacks
`read:project`.

## Secret Safety

Evidence includes sanitized summaries and excerpts only. It does not include raw
secret-bearing logs, env dumps, tokens, auth headers, cookies, or private
credentials.

## Residual Risks

- PR-007 is projection-level backpressure. It does not wire a live external
  transport slow-reader loop yet because PR-010 owns reconnect/resume transport
  recovery and PR-008 owns callback delivery.
- Server-request callback delivery failure/rejection remains PR-008.
- MCP/dynamic tool callback compatibility remains PR-009.
- Reconnect/resume after disconnect remains PR-010.
