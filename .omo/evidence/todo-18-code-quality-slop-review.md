# TODO18 Code Quality / Slop Review

Date: 2026-07-07

## Scope

Changed TODO18 files reviewed:

- `packages/coding-agent/src/core/extensions/builtin/mcp/idle.ts`
- `packages/coding-agent/src/core/extensions/builtin/mcp/service.ts`
- `packages/coding-agent/src/core/extensions/builtin/mcp/service-snapshot.ts`
- `packages/coding-agent/src/core/extensions/builtin/mcp/expose/register.ts`
- `packages/coding-agent/test/mcp/idle.test.ts`

Unrelated stop-hook evidence files are intentionally excluded from TODO18 staging.

## LOC

Pure LOC proof captured in `.omo/evidence/task-18-senpi-mcp-plugin-ts-audit.log`.

| File | Pure LOC |
|---|---:|
| `packages/coding-agent/src/core/extensions/builtin/mcp/expose/register.ts` | 177 |
| `packages/coding-agent/src/core/extensions/builtin/mcp/service-snapshot.ts` | 26 |
| `packages/coding-agent/src/core/extensions/builtin/mcp/service.ts` | 246 |
| `packages/coding-agent/src/core/extensions/builtin/mcp/idle.ts` | 138 |
| `packages/coding-agent/test/mcp/idle.test.ts` | 168 |

Conclusion: every changed TS file is under the project 250 pure LOC limit.

## TypeScript Hygiene

Audit command:

```bash
rg -n --no-heading --color never '\bany\b|@ts-ignore|@ts-expect-error|await import\(|import\(|\benum\b|\bnamespace\b|\bmodule\b|import\s*=|export\s*=' \
  packages/coding-agent/src/core/extensions/builtin/mcp/expose/register.ts \
  packages/coding-agent/src/core/extensions/builtin/mcp/service-snapshot.ts \
  packages/coding-agent/src/core/extensions/builtin/mcp/service.ts \
  packages/coding-agent/src/core/extensions/builtin/mcp/idle.ts \
  packages/coding-agent/test/mcp/idle.test.ts
```

Result: no matches. No `any`, suppression comments, dynamic imports, `enum`, `namespace`, `module`, `import =`, or `export =` were introduced.

## Lifecycle / Timer Review

- `idle.ts` owns the lifecycle timers in a WeakMap keyed by `ServerConnection`, keeping the abstraction local to MCP service connections.
- Idle timers use `safeTimer`, and keep-alive timers use `safeInterval`; both helpers unref timers and route async failures through the MCP logger.
- `disposeMcpConnectionLifecycle` clears both timers and unsubscribes state listeners before connection disposal.
- `runMcpConnectionLifecycleCall` increments `inFlight`, clears the idle timer, and refreshes timers in `finally`, covering successful and failed calls.
- Keep-alive uses a fixed `MCP_KEEP_ALIVE_INTERVAL_MS = 30_000` and wraps ping/recover work in `runMcpConnectionLifecycleCall`.

Conclusion: no ref'ed timers, orphaned intervals, or overbroad lifecycle manager were introduced.

## Test Quality

Focused test: `.omo/evidence/task-18-senpi-mcp-plugin-green.log`

- Default idle timeout remains 10 minutes.
- Connected zero-in-flight server idles after configured window and process exits.
- Eager server connects on session start and still idles after the configured window.
- Long-running tool call blocks idle until the call completes.
- Renewal critical section keeps idle timer paused until the renewal path returns.
- Cached tool reconnects transparently after idle shutdown.
- Keep-alive pings every 30 seconds, recovers a killed fixture, succeeds on the next tool call, and emits no `suspended` state for the single kill.

Impacted test: `.omo/evidence/task-18-senpi-mcp-plugin-impacted.log`

- Startup race, ping-on-call, service lifecycle, connection, and direct register-call MCP tests pass.

Conclusion: tests drive real stdio MCP fixtures and assert observable process/state/tool-call behavior. No hollow tests were added.

## Prompt Cache / Secret Safety

- The change does not alter prompt/cache serialization formats.
- Idle shutdown preserves cached catalog entries; reconnect is exercised through cached direct tool registration.
- Logs and evidence avoid auth headers, env dumps, cookies, tokens, and private credentials.
- Manual QA is required to run in isolated `SENPI_CODING_AGENT_DIR` / `SENPI_CODING_AGENT_SESSION_DIR` sandboxes and prove the real `~/.senpi/agent/auth.json` hash is unchanged.

## Verification Artifacts

- Focused tests: `.omo/evidence/task-18-senpi-mcp-plugin-green.log`
- Impacted MCP tests: `.omo/evidence/task-18-senpi-mcp-plugin-impacted.log`
- Root check: `.omo/evidence/task-18-senpi-mcp-plugin-check.log`
- TS audit / LOC proof: `.omo/evidence/task-18-senpi-mcp-plugin-ts-audit.log`
