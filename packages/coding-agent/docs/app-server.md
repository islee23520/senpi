# App Server Mode

App Server mode exposes senpi as a Codex-compatible JSON-RPC server for app and editor integrations.

## Starting App Server Mode

Primary websocket recipe:

```bash
senpi app-server --listen ws://127.0.0.1:18990
```

The websocket listener binds only to IP literal hosts. When `--ws-auth` is omitted, senpi creates or reuses a bearer token file at `${SENPI_CODING_AGENT_DIR:-~/.senpi/agent}/app-server/ws-token`, prints that path to stderr, and requires `Authorization: Bearer <token>` on websocket upgrades.

```bash
token="$(cat ~/.senpi/agent/app-server/ws-token)"
websocat -H "Authorization: Bearer $token" ws://127.0.0.1:18990/
```

Authentication options:

- `--ws-auth <path>` reads the bearer token from an explicit file.
- `--ws-auth off` disables bearer auth only for loopback websocket hosts.

For an embedded subprocess, use stdio:

```bash
senpi app-server --listen stdio://
```

`stdio://` is also the default when `--listen` is omitted. The command accepts `unix://` and `unix:///abs/path` in the `--listen` grammar for local-control socket addresses, but this document does not cover daemon lifecycle or control-socket management.

## Protocol Overview

App Server mode speaks JSON-RPC-shaped messages without a `jsonrpc` field. A request has `id`, `method`, and optional `params`; a success response has `id` and `result`; an error response has `id` and `error`.

Clients must send `initialize` before any other request. Requests before initialization return `-32000 Not initialized`; a second `initialize` returns `-32000 Already initialized`. Methods that are not implemented return `-32601 Method not found`, including unsupported Codex methods such as `thread/search`.

The protocol types are generated from `codex-cli 0.142.5` and adapted through the app-facing facade in `src/modes/app-server/protocol/`. Regenerate the raw pinned types with:

```bash
packages/coding-agent/scripts/generate-app-server-protocol.sh
```

Wire compatibility is the JSON-RPC message shape documented here, not the raw generated TypeScript tree.

## Framing

For `stdio://`, each message is one UTF-8 JSON object followed by LF (`\n`). stdout is reserved for protocol frames; status and logs go to stderr.

For `ws://`, each websocket text frame is one JSON object. Binary frames are ignored. HTTP `Origin` headers are rejected, `/readyz` and `/healthz` return `ok\n` while the listener is accepting connections, and websocket clients that exceed outbound backpressure limits are closed with code `1013`.

## Methods

### initialize

Initialize the connection and declare client capabilities. This live response was captured from a fresh stdio run during the docs update:

```json
{"id":1,"result":{"userAgent":"task20-docs/2026.7.2 (Darwin 25.4.0; arm64) senpi_app_server","codexHome":"/tmp/senpi-task20-doc-agent","platformFamily":"unix","platformOs":"macos"}}
```

Request:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"task20-docs","title":"Task 20 Docs","version":"0.0.1"},"capabilities":{"experimentalApi":false,"requestAttestation":false}}}
```

`capabilities.experimentalApi` gates experimental methods and notifications. `capabilities.optOutNotificationMethods` may list notification method names the client does not want to receive.

### model/list

List configured models. The live response contains the full model catalog; this reduced response keeps the same object field shape as the live wire output.

Request:

```json
{"id":2,"method":"model/list","params":{"includeHidden":false}}
```

Response:

```json
{"id":2,"result":{"data":[{"id":"anthropic/claude-opus-4-8","model":"claude-opus-4-8","upgrade":null,"upgradeInfo":null,"availabilityNux":null,"displayName":"Claude Opus 4.8","description":"","hidden":false,"supportedReasoningEfforts":[{"reasoningEffort":"minimal","description":""},{"reasoningEffort":"low","description":""},{"reasoningEffort":"medium","description":""},{"reasoningEffort":"high","description":""},{"reasoningEffort":"xhigh","description":""},{"reasoningEffort":"max","description":""}],"defaultReasoningEffort":"medium","inputModalities":["text"],"supportsPersonality":false,"additionalSpeedTiers":[],"serviceTiers":[],"defaultServiceTier":null,"isDefault":true}],"nextCursor":null}}
```

### remoteControl/status/read

Read the current remote-control status stub. This method requires `capabilities.experimentalApi: true`.

Request:

```json
{"id":3,"method":"remoteControl/status/read"}
```

Response:

```json
{"id":3,"result":{"status":"inactive"}}
```

Without the experimental capability, the same request returns:

```json
{"id":3,"error":{"code":-32600,"message":"remoteControl/status/read requires experimentalApi capability"}}
```

### thread/start

Start a new app-server thread and subscribe the initializing connection to that thread.

Request:

```json
{"id":2,"method":"thread/start","params":{"cwd":"/tmp/senpi-task20-thread-cwd"}}
```

The server may emit a notification before the correlated response:

```json
{"method":"thread/started","params":{"thread":{"id":"019f2406-934e-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-934e-7ab5-8dbb-f6a16914e785","forkedFromId":null,"parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"anthropic","createdAt":1783015838.585,"updatedAt":1783015838.585,"recencyAt":1783015838.585,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/2026-07-02T18-10-38-542Z_019f2406-934e-7ab5-8dbb-f6a16914e785.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]}}}
```

Response:

```json
{"id":2,"result":{"thread":{"id":"019f2406-934e-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-934e-7ab5-8dbb-f6a16914e785","forkedFromId":null,"parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"anthropic","createdAt":1783015838.585,"updatedAt":1783015838.585,"recencyAt":1783015838.585,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/2026-07-02T18-10-38-542Z_019f2406-934e-7ab5-8dbb-f6a16914e785.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]},"model":"claude-opus-4-8","modelProvider":"anthropic","serviceTier":null,"cwd":"/tmp/senpi-task20-thread-cwd","runtimeWorkspaceRoots":["/tmp/senpi-task20-thread-cwd"],"instructionSources":[],"approvalPolicy":"never","approvalsReviewer":"user","sandbox":{"type":"dangerFullAccess"},"activePermissionProfile":null,"reasoningEffort":"medium","multiAgentMode":"explicitRequestOnly"}}
```

### thread/resume

Load an existing saved thread and subscribe the connection to it.

Request:

```json
{"id":4,"method":"thread/resume","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785"}}
```

Response:

```json
{"id":4,"result":{"thread":{"id":"019f2406-934e-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-934e-7ab5-8dbb-f6a16914e785","forkedFromId":null,"parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"anthropic","createdAt":1783015838.585,"updatedAt":1783015838.585,"recencyAt":1783015838.585,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/2026-07-02T18-10-38-542Z_019f2406-934e-7ab5-8dbb-f6a16914e785.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]},"model":"claude-opus-4-8","modelProvider":"anthropic","serviceTier":null,"cwd":"/tmp/senpi-task20-thread-cwd","runtimeWorkspaceRoots":["/tmp/senpi-task20-thread-cwd"],"instructionSources":[],"approvalPolicy":"never","approvalsReviewer":"user","sandbox":{"type":"dangerFullAccess"},"activePermissionProfile":null,"reasoningEffort":"medium","multiAgentMode":"explicitRequestOnly","initialTurnsPage":null}}
```

### thread/loaded/list

List loaded threads in the current app-server process.

Request:

```json
{"id":5,"method":"thread/loaded/list","params":{"limit":1}}
```

Response:

```json
{"id":5,"result":{"data":[{"id":"019f2406-934e-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-934e-7ab5-8dbb-f6a16914e785","forkedFromId":null,"parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"unknown","createdAt":1783015838.585,"updatedAt":1783015838.585,"recencyAt":1783015838.585,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/2026-07-02T18-10-38-542Z_019f2406-934e-7ab5-8dbb-f6a16914e785.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]}],"nextCursor":null}}
```

### thread/read

Read one thread. Pass `includeTurns: true` to include turn records.

Request:

```json
{"id":6,"method":"thread/read","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","includeTurns":false}}
```

Response:

```json
{"id":6,"result":{"thread":{"id":"019f2406-934e-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-934e-7ab5-8dbb-f6a16914e785","forkedFromId":null,"parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"anthropic","createdAt":1783015838.585,"updatedAt":1783015838.585,"recencyAt":1783015838.585,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/2026-07-02T18-10-38-542Z_019f2406-934e-7ab5-8dbb-f6a16914e785.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]}}}
```

### thread/name/set

Set the display name for a thread.

Request:

```json
{"id":7,"method":"thread/name/set","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","name":"Docs example"}}
```

Response:

```json
{"id":7,"result":{}}
```

### thread/fork

Fork a thread into a new session-backed thread.

Request:

```json
{"id":8,"method":"thread/fork","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","cwd":"/tmp/senpi-task20-thread-cwd"}}
```

Response:

```json
{"id":8,"result":{"thread":{"id":"019f2406-ffff-7ab5-8dbb-f6a16914e785","sessionId":"019f2406-ffff-7ab5-8dbb-f6a16914e785","forkedFromId":"019f2406-934e-7ab5-8dbb-f6a16914e785","parentThreadId":null,"preview":"","ephemeral":false,"modelProvider":"anthropic","createdAt":1783015839.000,"updatedAt":1783015839.000,"recencyAt":1783015839.000,"status":{"type":"idle"},"path":"/tmp/senpi-task20-thread-sessions/fork.jsonl","cwd":"/tmp/senpi-task20-thread-cwd","cliVersion":"2026.7.2","source":"appServer","threadSource":null,"agentNickname":null,"agentRole":null,"gitInfo":null,"name":null,"turns":[]},"model":"claude-opus-4-8","modelProvider":"anthropic","serviceTier":null,"cwd":"/tmp/senpi-task20-thread-cwd","runtimeWorkspaceRoots":["/tmp/senpi-task20-thread-cwd"],"instructionSources":[],"approvalPolicy":"never","approvalsReviewer":"user","sandbox":{"type":"dangerFullAccess"},"activePermissionProfile":null,"reasoningEffort":"medium","multiAgentMode":"explicitRequestOnly"}}
```

### thread/archive

Archive and unload a thread.

Request:

```json
{"id":9,"method":"thread/archive","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785"}}
```

Response:

```json
{"id":9,"result":{}}
```

### thread/delete

Delete a thread.

Request:

```json
{"id":10,"method":"thread/delete","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785"}}
```

Response:

```json
{"id":10,"result":{}}
```

### thread/unsubscribe

Unsubscribe the current connection from a loaded thread. When the thread is not loaded, the response status is `notLoaded`.

Request:

```json
{"id":11,"method":"thread/unsubscribe","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785"}}
```

Response:

```json
{"id":11,"result":{"status":"unsubscribed"}}
```

### turn/start

Start an agent turn on a loaded thread. The response is emitted after the prompt is accepted; later output arrives as notifications.

Request:

```json
{"id":12,"method":"turn/start","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","input":[{"type":"text","text":"Say ok."}]}}
```

Response:

```json
{"id":12,"result":{"turn":{"id":"turn-019f2406","items":[],"itemsView":[],"status":"inProgress","error":null,"startedAt":1783015840.000,"completedAt":null,"durationMs":null}}}
```

### turn/steer

Queue steering text for an active turn.

Request:

```json
{"id":13,"method":"turn/steer","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","expectedTurnId":"turn-019f2406","input":[{"type":"text","text":"Prefer the shorter answer."}]}}
```

Response:

```json
{"id":13,"result":{"turnId":"turn-019f2406"}}
```

### turn/interrupt

Interrupt an active turn. Interrupting a non-active or already-finished turn is a successful no-op.

Request:

```json
{"id":14,"method":"turn/interrupt","params":{"threadId":"019f2406-934e-7ab5-8dbb-f6a16914e785","turnId":"turn-019f2406"}}
```

Response:

```json
{"id":14,"result":{}}
```

### Unsupported Methods

Unsupported methods return `-32601`.

Request:

```json
{"id":15,"method":"thread/search","params":{"query":"docs"}}
```

Response:

```json
{"id":15,"error":{"code":-32601,"message":"Method not found: thread/search"}}
```

## Implemented Method Inventory

Implemented stable methods:

- `initialize`
- `model/list`
- `thread/start`, `thread/resume`, `thread/fork`, `thread/read`, `thread/list`, `thread/loaded/list`, `thread/name/set`, `thread/archive`, `thread/delete`, `thread/unsubscribe`
- `turn/start`, `turn/steer`, `turn/interrupt`

Implemented experimental methods:

- `remoteControl/status/read`, returning the inactive status stub

Every other stable or experimental Codex request method currently returns `-32601 Method not found`, except experimental methods that first fail the capability gate with `-32600`.

## Notifications And Routing

Clients must route two independent streams:

- Responses correlate to requests by `id`.
- Notifications have `method` and optional `params`, no `id`, and may arrive before, between, or after correlated responses.

Broadcast notifications currently include thread lifecycle and status changes such as `thread/started`, `thread/status/changed`, `thread/closed`, `thread/deleted`, `thread/archived`, `thread/name/updated`, and `thread/tokenUsage/updated`. Thread-scoped notifications are delivered only to connections subscribed to that thread. Terminal notifications such as `turn/completed` and `error` are queued briefly when no subscriber is attached, then replayed to the next subscriber until the per-thread terminal queue limit is reached.

Experimental notifications such as `remoteControl/status/changed` are delivered only when the connection initialized with `capabilities.experimentalApi: true`. Clients may opt out of specific notification method names during `initialize`.

## Approvals Flow

When a running turn needs user approval, the server sends a request-like outbound message to subscribers of the affected thread. Approval request methods include `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`.

Command approval decisions are `accept`, `acceptForSession`, `decline`, and `cancel`. `acceptForSession` is remembered for matching command approvals in the same thread. If no subscriber is attached, the approval is declined with a no-subscriber reason. When a turn ends, pending approvals for that thread are cancelled and `serverRequest/resolved` is emitted.

## Multi-Session Semantics

Each app-server process can keep multiple loaded threads. `thread/start`, `thread/resume`, and `thread/fork` load a thread and subscribe the current connection. `thread/unsubscribe` detaches only that connection; the thread may unload after the idle timeout when it has no subscribers and no active turn. A websocket listener can serve multiple initialized clients concurrently. Stdio mode serves one process-owned connection.
