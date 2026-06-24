# PR-005 routing-state evidence summary

This work is using code-yeongyu/lazycodex teammode.

## Summary

PR-005 adds pure routing/session-state support for `pi-codex-app-server` after PR-004 runtime transport.

Implemented scope:

- Session registry for external session id to authoritative app-server thread/session id bindings.
- Duplicate binding guards for external session ids and app-server thread ids.
- Request, turn, item, and server-request correlation maps.
- External request router for initialize, initialized, session/thread operations, and turn start/steer/interrupt.
- PR-005 fixtures for initialize field names, session lifecycle/tombstones, duplicate binding policy, and turn id routing.

Out of scope:

- Streaming projection.
- Server callback execution.
- Reconnect durability.
- Redaction QA.
- Final compatibility evidence packet.

## Evidence

Raw logs are under `local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-005-routing/`.

- Failing-first proof: `failing-first.txt`.
- Targeted routing initial green: `targeted-routing-initial.txt`.
- Focused PR-001 through PR-005 suite after split: `targeted-suite-after-split.txt`.
- Focused suite after type fix: `targeted-suite-after-type-fix.txt`.
- Focused suite after duplicate session preflight: `targeted-suite-after-preflight.txt`.
- Full check: `npm-run-check-after-preflight.txt`.
- senpi QA common self-check: `senpi-qa-common-self-check.txt`.
- senpi QA CLI smoke: `senpi-qa-cli-smoke.txt`.
- senpi QA mock loop: `senpi-qa-mock-loop.txt`.
- Adapter harness help: `drive-adapter-help.txt`.
- Cleanup receipt: `cleanup-receipt.txt`.
- Secret-safety receipt: `secret-safety.txt`.
- GitHub Project tracking: `project-tracking.txt`.

## Project Tracking

`BLOCKED:missing-gh-project-scope`

`gh project list --owner code-yeongyu --format json --limit 20` failed because the current token lacks `read:project`. This is recorded but does not block PR creation.

## Residual Risks

- PR-005 routes against a pure app-server request-client seam; live JSON-RPC transport wiring remains downstream of PR-004 runtime integration.
- App-thread collisions are rejected after app-server response unless a future route exposes a reliable incoming app-server `thread_id` preflight.
- PR-010 still owns resume tokens, snapshot reload, replay cursors, pending callback replay/rejection, tombstones durability, and duplicate terminal protection.
