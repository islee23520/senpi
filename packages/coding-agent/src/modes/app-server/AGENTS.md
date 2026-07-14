# packages/coding-agent/src/modes/app-server

Codex-compatible app-server mode. It exposes Senpi threads and turns over JSON-RPC-shaped stdio, Unix-socket, and authenticated WebSocket transports.

## STRUCTURE

```text
index.ts              Mode entry and listener selection
cli-args.ts           app-server argument parsing
daemon/               Background process probing and lifecycle
rpc/                  Envelopes, errors, NDJSON framing, method registry
server/               Connection state, approvals, notifications, dispatch
threads/              Session-backed thread registry, projection, turns
transports/           stdio, Unix socket, WebSocket auth/backpressure
protocol/             App-facing facade plus pinned generated Codex evidence
turn-adapter.ts       Agent/session events to app-server turn events
```

## INVARIANTS

- Clients initialize exactly once before other methods. Preserve correlated request/response IDs and JSON-RPC error codes.
- Stdio uses one UTF-8 JSON object per LF-delimited line; stdout is protocol-only and diagnostics go to stderr.
- WebSocket listeners bind IP literals. Bearer auth is required unless explicitly disabled for loopback, and `Origin` requests remain rejected.
- Keep connection subscriptions, thread ownership, archive/unload, and turn cancellation consistent across disconnect and daemon shutdown.
- Approval payloads and diagnostics can contain sensitive material. Preserve redaction and restricted token-file permissions.
- Generated files under `protocol/generated/` are evidence, not build input. Never import or edit them directly; use the non-generated facade.

## WHERE TO LOOK

| Task | Path |
|---|---|
| Add a method | `rpc/registry.ts` and the matching handler |
| Change connection lifecycle | `server/connection.ts`, `server/server-core.ts` |
| Change thread/session projection | `threads/` |
| Change transport behavior | `transports/` |
| Change approvals | `server/approval-*.ts`, `server/approvals.ts` |
| Change wire types | `protocol/` and `docs/app-server.md` |

## GENERATED PROTOCOL

- The pinned raw protocol comes from Codex and is regenerated with `packages/coding-agent/scripts/generate-app-server-protocol.sh`.
- Keep `protocol/generated/**/*.ts` byte-identical to generator output. The local `generated/package.json` is only a compilation shim.
- Wire compatibility is defined by runtime message shape and the app-facing facade, not by importing raw generated modules.

## VALIDATION

- Run focused app-server Vitest suites from `packages/coding-agent`.
- Run `npm run qa:app-server` for the real stdio, WebSocket, Unix-socket, handshake, and lifecycle scenarios.
- Protocol or documentation changes must keep `docs/app-server.md` examples and `test/qa/app-server/` checks aligned.
- Runtime changes also require root `npm run check` and the applicable real CLI QA evidence gate.
