# senpi-codemode Full-Parity Port of oh-my-pi eval

## TL;DR
> Summary:      Port oh-my-pi's entire eval subsystem (~21.5k LOC surface) to full parity inside `packages/senpi-codemode` — kernels, helper preludes, status events, output spill, agent()/output() bridges, prompt, and TUI rendering — with ZERO senpi core changes (extension-first) and no staging.
> Deliverables: 18 todos across 4 waves: settings v2 + protocol v2 + OutputSink + json-tree + types (Wave 1); py/js/rb/jl kernel parity + timeout wiring (Wave 2); agent()/output()/completion()/concurrency bridges (Wave 3); eval-tool core v2 + prompt v2 + render v2 + test-parity ledger (test/PARITY.md) + docs (Wave 4). QA driver scripts (qa-{py,js,rb,jl}-cell.ts, qa-e2e-eval.ts, qa-render-dump.ts) double as evidence generators.
> Effort:       XL
> Risk:         Medium - the eval-tool core rework (todo 14) integrates 10 upstream todos; kernel-level parity (magics, auto-display, import rewriting) carries subtle behavioral edges mitigated by the omp test-parity contract (todo 17).
> Decisions:    User: agent()/output() = task-tool contract delegation (NO senpi-task import); web GUI renderer EXCLUDED; budget helper SKIPPED entirely; TDD + senpi-qa manual QA. Adopted defaults (veto any): Bun→Node adaptation for js kernel (forced by platform); env flags renamed PI_* → SENPI_CODEMODE_*; artifact spill = session-adjacent `<session>-artifacts/` dir with plain file paths (no artifact:// scheme); examples embedded in tool description (senpi ToolDefinition has no examples field); schema/description narrowing via session_start re-registration (senpi copies fields at wrap time); omp REPL user-surface (EvalExecutionComponent) excluded as non-tool UI; plan-mode gate dropped (senpi has no plan mode); AgentOutputManager caching skipped (task engine owns transcripts); agent() `isolated`/`apply`/`merge` kwargs accepted-but-dropped with warning (no isolation in task engine); output() `format:"json"|"stripped"`/`query` dropped (no omp metadata) — format maps to task_output mode full/tail.

## Context

### Original request
"oh my pi 꺼를 거의 그대로 다 가져오게 하는, extension if possible 의 원칙을 유지하도록 하게하고 v1 이라던가 mvp 라던가 이런거없이 온전히 완전히 포팅해오는 작업계획서 high accuracy 로 작성" — port oh-my-pi's eval subsystem into senpi, fully (no v1/MVP staging), keeping the extension-first principle.

### Interview summary
- **Q1 agent()/output() substrate**: user directed investigation of `../omo/packages/senpi-task`. Resolution: senpi-codemode NEVER imports senpi-task (private, omo-workspace deps). Instead `agent()`/`output()` delegate through `pi.executeTool("task"/"task_output", …)` — a tool-contract composition. When a `task` tool is registered (e.g. by omo-senpi), agent() is live; when absent, agent()/output() are omitted from the prompt and error clearly when invoked. Zero imports, zero core changes.
- **Q2 web GUI renderer**: EXCLUDED per user ("어 이런건 필요없는데"). TUI + HTML-export parity only (HTML export reuses renderCall/renderResult automatically).
- **Q3 budget helper**: SKIPPED entirely per user ("이건 스킵이 맞을듯"). `budget` must not appear in preludes, prompt, or schema. Documented divergence.
- **Q4 test strategy**: TDD + omp test-parity contract + manual QA via senpi-qa harness (rpc/mock-loop channels).

### Research findings
- **Port surface (oh-my-pi)**: `packages/coding-agent/src/eval/**` = 16,375 LOC; plus `src/tools/eval.ts` (767), `src/tools/eval-render.ts` (776), `src/tools/eval-backends.ts` (34), `src/tools/json-tree.ts` (260), `src/tools/output-meta.ts` (818), `src/prompts/tools/eval.md` (72), `src/session/streaming-output.ts` (1,330), `src/utils/image-resize.ts` (420), `src/task/spawn-policy.ts` (58). Total ≈ 21.5k LOC.
- **Existing senpi-codemode** ≈ 5.3k LOC already ports: 4 kernels (py/js/rb/jl), HTTP loopback bridge (token auth, 10MiB frames — `src/bridge/protocol.ts`), TypeBox eval schema (`src/tool/types.ts`), prompt template engine (`src/prompt/eval-prompt.ts`), CellHandler (`src/tool/cell-handler.ts`), completion bridge (`src/completion/`), TUI render (`src/tool/render.ts`), session lifecycle (`src/extension/session-manager.ts`, `src/index.ts`), idle/bridge timeouts (`src/timeouts/`).
- **CRITICAL — narrowing timing**: senpi copies `description`/`parameters` at wrap time (`packages/coding-agent/src/core/tools/tool-definition-wrapper.ts:5-19`); omp reads them via getters per request. BUT `registerTool()` after load replaces by name and triggers `refreshTools()` → `_refreshToolRegistry()` (`packages/coding-agent/src/core/extensions/loader.ts:290-296`, `packages/coding-agent/src/core/agent-session.ts:3144-3177`). → Re-register the eval tool inside `session_start` after settings + interpreter availability resolve.
- **executeTool pipeline**: `pi.executeTool(toolName, params, {signal, onUpdate})` runs the full validation/hook/permission pipeline and returns `AgentToolResult` (`packages/coding-agent/src/core/agent-session.ts:1193-1203`, `packages/coding-agent/src/core/extensions/types.ts:1627-1632`). Error codes: `unknown_tool | inactive_tool | invalid_params | blocked` (types.ts:1634).
- **Tool detection**: `pi.getActiveTools(): string[]` (`types.ts:1405-1406`) — gates agent()/output() exposure.
- **Render surface**: `ToolRenderContext` provides `expanded`, `spinnerFrame`, `imageProtocol`, `showImages`, `isPartial`, `state`, `invalidate` (`packages/coding-agent/src/core/extensions/types.ts:460-488`). Theme/syntax exports for extensions: `highlightCode`, `getMarkdownTheme`, `Theme`, `ThemeColor` (`packages/coding-agent/src/index.ts:383-392`); `resizeImage`, `formatDimensionNote` (index.ts:397); `sanitizeTerminalLabel` (index.ts:3). HTML export reuses renderCall/renderResult via ANSI→HTML (`packages/coding-agent/src/core/export-html/tool-renderer.ts:99-110`).
- **No artifact system / no turn budget in senpi**: no `artifact://`, no `allocateOutputArtifact`, no `getTurnBudget`. Bash spill-to-temp-file precedent: `packages/coding-agent/src/core/bash-executor.ts:58-184`.
- **Bundled loading already wired**: `@code-yeongyu/senpi-codemode` loads as a builtin-adjacent bundled extension (`packages/coding-agent/src/core/resource-loader.ts:82-92`); no coding-agent changes needed for loading.
- **senpi-task task tool contract** (reference-only, no import): `task {prompt, description?, category?, subagent_type?, run_in_background?, name?, model?, load_skills?}` (`/Users/yeongyu/local-workspaces/omo/packages/senpi-task/src/tools/task/params.ts:3-25`); `task_output {task_id?, name?, mode?: "status"|"tail"|"full", tail_lines?, block?, timeout_ms?}` where `runTaskOutput` requires `task_id ?? name` and the DEFAULT `mode:"status"` returns a record snapshot — transcripts come from `mode:"tail"|"full"` (`/Users/yeongyu/local-workspaces/omo/packages/senpi-task/src/tools/output/output.ts:14-60`); background spawn returns `st_…` id. In-process children get parent tools minus `task_*`/`team_*` (`filterSharedParentTools`) → child eval cells cannot re-spawn: recursion self-gates. NOTE: tool NAMES ("task"/"task_output") are the senpi-task registration defaults; codemode reads them from settings `taskTools` so deployments with renamed tools still work.
- **omp ToolSession seams used by eval** (`packages/coding-agent/src/tools/eval.ts:301-738`, `src/eval/agent-bridge.ts:151-339` in oh-my-pi): getSessionSpawns, getActiveModel, assertEvalExecutionAllowed, getSessionFile, getEvalKernelOwnerId, allocateOutputArtifact, getEvalSessionId, trackEvalExecution, getPlanModeState, agentOutputManager, getArtifactsDir, getTurnBudget, getActiveModelString. Each maps to an extension-local equivalent (see Decisions).
- **Loader virtual modules**: extensions resolve `typebox`, `@earendil-works/pi-*`, `@code-yeongyu/senpi` via VIRTUAL_MODULES in compiled binaries (`packages/coding-agent/src/core/extensions/loader.ts:47-63`); other deps (e.g. `@babel/parser`) resolve from senpi-codemode's own package deps — pin exactly per repo policy.
- **QA harness**: `.agents/skills/senpi-qa/scripts/{rpc-drive,mock-loop,cli-smoke,tui-smoke}.mjs`, sandboxed (SENPI_CODING_AGENT_DIR temp, PI_OFFLINE=1), evidence to `local-ignore/qa-evidence/`.

### Metis review
| Gap | Resolution |
|---|---|
| Schema/description narrowing happens at registration, not per-request (wrapper copies fields) | Todo 14: re-register eval tool in `session_start` (Map.set replace + refreshTools); regression test asserts disabled language absent from schema AND rejected at execute |
| senpi ToolDefinition has no `examples` field (omp had ToolExample[]) | Embed reuse-chain examples into the description tail (omp eval.md content already example-shaped); recorded divergence |
| Bridge protocol has no `status` frame — omp preludes stream op events (read/write/env/…) | Todo 2: protocol v2 adds `status` frame; kernels emit; CellHandler upserts (port `upsertStatusEvent`) |
| agent() progress rendering source: task-tool `details` shape is engine-specific | Todo 10: synthesize `op:"agent"` EvalStatusEvents defensively from `executeTool` onUpdate (unknown details → minimal {id,status} ticks); QA uses a fake task tool |
| index.ts currently registers eval with all-4-languages hardcoded before settings load | Fixed by todo 14 re-registration flow |
| output() needs the task-output tool name | codemode.json `taskTools: {task:"task", output:"task_output"}` (todo 1) |
| omp plan-mode gate (assertNotPlanMode) has no senpi equivalent | No-op with explanatory comment (todo 10); documented divergence |
| budget skip must be consistent everywhere | Must-NOT-have guardrail + prompt snapshot test asserts absence (todo 15) |
| Dirty worktree | `packages/tui/package.json`, `scripts/release.mjs`, `packages/tui/test/setup-multiplexer-env.mjs` — untouched by every todo (guardrail) |
| Recursion depth for agent() | In-process senpi-task children lose `task_*` tools → agent() unavailable in children (self-gating); RPC children run isolated senpi without parent's dynamic state. Document; no depth counter needed |
| PI_PY/PI_JS/PI_RB/PI_JL env flags are omp-branded | Adapted to `SENPI_CODEMODE_PY/JS/RB/JL` (todo 1); recorded divergence |
| `local://` scheme has no senpi backing | Maps to `<session-artifacts>/local/` root resolved by the extension (todo 2/3); helpers accept it in read/write |

### Fable 5 oracle review (adversarial, post-lint)
Verdict ITERATE → all cited issues resolved below:
| # | Issue | Resolution |
|---|---|---|
| 1 CRITICAL | todo 11 delegated to `task_output` with invented `{to}` param; real contract is `{task_id?/name?, mode, tail_lines, block, timeout_ms}` with default mode:"status" returning a snapshot, not transcript | Todo 11 rewritten: `{task_id: id, mode: "full", block: true}`; fakes/QA fixtures mirror the REAL param shape (assert on `task_id` + `mode`) |
| 2 MAJOR | outputSink `{0,0}` defaults falsely attributed to omp; omp defaults are headBytes 20KB (`settings-schema.ts:667-669`), maxColumns 768 (`settings-schema.ts:689-691`) | Todo 1 defaults changed to `{headBytes: 20480, maxColumns: 768}` matching omp |
| 3 MAJOR | omp agent() also accepts `isolated/apply/merge` kwargs (py prelude.py:426, js prelude allow-list) — unaddressed | Todos 6-8 keep kernel kwargs accepted-but-marshaled; todo 10 host DROPS `isolated/apply/merge` with a status warning event (senpi-task has no isolation concept); listed in TL;DR divergences |
| 4 MAJOR | "senpi-task" string guardrail grep collided with mandated explanatory comments | Greps narrowed to IMPORT-FORM only: `grep -rn "from \"@oh-my-opencode\|require(\"@oh-my-opencode\|from '@oh-my-opencode" src/` → 0; comments may name senpi-task freely |
| 5 MAJOR | Waves 2/3 concurrency claim hid QA-script deps (qa-py/js-cell.ts) and a cell-handler.ts write conflict between 10 and 11 | Matrix rewritten: 10,12,13 blocked by 6; 9,11 blocked by 7; 11 blocked by 10; 12's `--with-fake-completion` flag added to 12's Files list |
| 6 MAJOR | todo 17 test inventory omitted omp `test/eval/` dir (agent-bridge, console-table, display-image-coerce, process-stdio-capture, runtime-global-dispose, worker-core) and misplaced eval-workflow-helpers (lives in test/core/) | Inventory corrected + spot-check loop extended to cover the omitted files |
| 7 MINOR | output() `format:"json"`/`query` semantics unspecified | Schema narrowed to `format?: "raw"\|"tail"` (maps to task_output mode); `query`/`json`/`stripped` dropped — documented divergence (task engine owns transcripts, no omp metadata) |
| 8 MINOR | todo 11's reference lines pointed at plumbing, not the contract; `__output__` is a codemode invention, not an omp name | Reference fixed to omp preludes (py prelude.py:118-230, js prelude.txt:78-91); `__output__`/`__agent__` reserved names + bridge op constants now created in todo 2 as `src/bridge/reserved.ts` and labeled ADAPTATION |
| 9 MINOR | pause/resume op names shown as invented `__eval_timeout_pause__`; omp canon is `"timeout-pause"`/`"timeout-resume"` (bridge-timeout.ts:19-22) | Canonical constants defined once in todo 2's reserved.ts; todo 6(f) and todo 9 bodies import them (round-2 fix: todo 9's stale literal + "senpi-local names" instruction rewritten) |
| 10 MINOR | todo 16 QA scenario 1 (tui-smoke self-test) passes against unchanged code | Replaced with a second qa-render-dump behavioral scenario (narrow-width CJK reflow) that fails against current render.ts; tui-smoke moved to F3 |
| 11 MINOR | F1 budget grep narrower than the Must-NOT scope | Success-criteria grep widened to all of `src/` (tests excluded — PARITY.md legitimately names omp's budget tests as skipped) |
Could-not-verify items → mitigations: bundled-extension auto-load in `createAgentSession` (todo 14 specifies `customExtensions`/InlineExtension loading explicitly, not discovery); live omo-senpi tool names (settings-driven via `taskTools`, not hardcoded); omp IdleTimeout resume semantics (todo 9 references idle-timeout.ts source directly — port from source, not from my summary).

## Scope

### Must have
- Full helper parity in all four preludes (py/js/rb/jl): `display, print/text output, read, write, env, tool.<name>, completion (schema+model), parallel, pipeline, log, phase, agent, output` — minus `budget` (user-excluded).
- Structured status events end-to-end: prelude op events (read/write/env/…) → bridge `status` frames → `EvalToolDetails.statusEvents` → TUI status lines with icons.
- agent()/output() via task-tool contract delegation (`pi.executeTool`), gated on task-tool presence, with `handle`/background support and `schema` structured output via prompt-injection + JSON parse.
- OutputSink/TailBuffer port: head+tail spill to session-adjacent artifacts dir, maxColumns clamp, truncation metadata + notice in details, live-tail streaming attribution (activeLiveCell).
- eval tool core v2: session_start re-registration (schema+description narrowing from settings+availability+task-tool presence), image resize/WebP exclusion, exit-code/cancel paths, per-cell details (cells[], statusEvents, jsonOutputs, notice, meta), disposal-safe execution tracking, proxy-executor constructor seam.
- Render parity: framed highlighted code cells, per-cell status/duration/title, status-event lines, agent-progress rows, JSON tree for display() values, spinner, expanded mode, truncation warnings, image fallbacks.
- Prompt parity: eval.md-equivalent template with spawns gating, examples embedded, Node.js wording, no budget.
- Test parity: every omp eval test file with applicable behavior has a senpi-codemode vitest counterpart, listed and green.
- All work inside `packages/senpi-codemode` — zero coding-agent/core source changes.

### Must NOT have (guardrails)
- NO `budget` helper anywhere (preludes, prompt, schema, tests) — user-excluded.
- NO web-ui/collab-web renderer work — user-excluded.
- NO user-facing REPL slash-command surface (omp `EvalExecutionComponent` belongs to omp's modes layer, same non-tool surface category the user cut; revisitable follow-up).
- NO import of `@oh-my-opencode/senpi-task` or any omo workspace package — contract-only coupling via executeTool.
- NO changes to `packages/coding-agent/**`, `packages/tui/**`, or any senpi core package source.
- NO edits to dirty-worktree paths: `packages/tui/package.json`, `scripts/release.mjs`, `packages/tui/test/setup-multiplexer-env.mjs`.
- NO Bun-only APIs (`Bun.*`, `with { type: "text" }` runtime imports) — senpi is Node ≥24; assets load via fs or are inlined constants.
- NO `any` types; erasable-syntax-only TypeScript (repo rule).
- NO npm-package publishing/version bumps (release flow is owner-run).
- NO new omp-branded env flags (PI_PY etc.) — use SENPI_CODEMODE_* namespace.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: **TDD** (write the failing vitest first, then implement) + omp test-parity contract. Framework: vitest via `npx tsx ../../node_modules/vitest/dist/cli.js --run test/<file>` from `packages/senpi-codemode` (existing `npm test` script).
- QA policy: every todo has agent-executed scenarios through a real surface: direct extension-pipeline driver scripts (Node, `createAgentSession` + `executeTool("eval", …)` from source via `npx tsx`), senpi-qa rpc/mock-loop channels for regression, real interpreter subprocesses for kernels.
- Evidence: `.omo/evidence/task-<N>-<slug>.<ext>`; F3 additionally aggregates copies under `local-ignore/qa-evidence/<YYYYMMDD>-codemode-port/` per repo AGENTS.md.
- Full static gate after code changes: `npm run check` from repo root (senpi AGENTS.md requirement).

## Execution strategy

### Parallel execution waves
Wave 1 (no deps): 1, 2, 3, 4, 5
Wave 2 (after 2,5): 6, 7, 8
Wave 3 (after Wave 2 + 1): 9, 10, 11, 12, 13
Wave 4 (after all above): 14, 15, 16, 17, 18
Critical path: 2 → 6/7 → 14 → 16 → 17
(Waves 2 and 3 are concurrent EXCEPT where a Wave-3 todo's QA consumes a Wave-2 QA driver script — those edges are explicit in Blocked-by below: 10/12/13 need qa-py-cell.ts from 6; 9/11 need qa-js-cell.ts from 7; 11 is blocked by 10 because both edit cell-handler.ts dispatch.)

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
|---|---|---|---|
| 1 settings v2 | none | 10,11,12,14 | 2,3,4,5 |
| 2 protocol v2 | none | 6,7,8,9,10,11 | 1,3,4,5 |
| 3 output infra | none | 14,16 | 1,2,4,5 |
| 4 json-tree | none | 16 | 1,2,3,5 |
| 5 types v2 | none | 6,7,8,9,10,11,14,16 | 1,2,3,4 |
| 6 py kernel parity | 2,5 | 10,12,13,14,17 | 7,8,9 |
| 7 js kernel parity | 2,5 | 9,11,14,17 | 6,8 |
| 8 rb/jl parity | 2,5 | 14,17 | 6,7,9,10-13 |
| 9 timeout wiring | 2,5,7 | 14 | 6,8,10,12,13 |
| 10 agent() bridge | 1,2,5,6 | 11,14,15,16,17 | 8,9,12,13 |
| 11 output() bridge | 1,2,5,7,10 | 14,17 | 8,12,13 |
| 12 completion v2 | 1,5,6 | 17 | 8,9,10,11,13 |
| 13 concurrency parity | 1,5,6 | 17 | 8,9,10,11,12 |
| 14 eval-tool core v2 | 1,3,5,6,7,8,9,10,11 | 15,16,17,18 | none (integration point) |
| 15 prompt v2 | 10,14 | 17,18 | 16 |
| 16 render v2 | 3,4,5,10,14 | 17,18 | 15 |
| 17 test-parity sweep | 6-16 | 18,F | none |
| 18 docs+packaging | 14,15,16,17 | F | none |

## TODOs
> Implementation + its test = ONE todo. Never separate them.

- [ ] 1. Settings v2 — codemode.json schema expansion + env flags
  **What to do**: Extend `packages/senpi-codemode/src/config/settings.ts` schema (TypeBox, `additionalProperties:false`): add `taskTools` (`{task?: string; output?: string}`, defaults `{"task","task_output"}`), `outputSink` (`{headBytes?: number; maxColumns?: number}`, defaults `{headBytes: 20480, maxColumns: 768}` — omp parity: `tools.artifactHeadBytes` default 20KB at oh-my-pi `src/config/settings-schema.ts:667-669`, `tools.outputMaxColumns` default 768 at `settings-schema.ts:689-691`; 0 disables either), `statusEvents` (boolean, default true). Add env overrides `SENPI_CODEMODE_PY/JS/RB/JL` (truthy "0"/"false" disables, "1"/"true" enables — port `$flag` semantics from oh-my-pi `packages/pi-utils` usage in `src/tools/eval-backends.ts:20-34`) applied AFTER file settings in a new `resolveEnabledLanguages(settings, env)` helper. Keep existing keys (`languages`, `cellTimeoutSeconds`, `parallelPoolWidth`) byte-compatible. TDD: extend `packages/senpi-codemode/test/config.test.ts` FIRST — new-key defaults, env-override precedence (env beats file), unknown-key rejection, malformed-value warnings.
  **Must NOT do**: No `budget` key. No PI_* env names. No changes outside senpi-codemode.
  **Parallelization**: Wave 1 | Blocks: 10,11,12,14 | Blocked by: none
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/config/settings.ts:1-128` — current schema/loader/defaults to extend; keep the `.senpi/codemode.json` → `~/.senpi/agent/codemode.json` candidate order.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval-backends.ts:1-34` — omp's settings+env resolution semantics being ported (settings default py/js on, rb/jl off; env flag overrides).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/config.test.ts` — existing test style to extend.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/config.test.ts` → exit 0, includes new cases `taskTools defaults`, `env override beats file`, `statusEvents default true`.
  **QA scenarios**:
  - Scenario: env flag disables a file-enabled language
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi` 2. `mkdir -p /tmp/cm-qa1/.senpi && printf '{"languages":{"rb":true}}' > /tmp/cm-qa1/.senpi/codemode.json` 3. `SENPI_CODEMODE_RB=0 npx tsx -e 'import {loadCodemodeSettings} from "./packages/senpi-codemode/src/config/settings.ts"; import {resolveEnabledLanguages} from "./packages/senpi-codemode/src/config/settings.ts"; const l = await loadCodemodeSettings({cwd:"/tmp/cm-qa1"}); console.log(JSON.stringify(resolveEnabledLanguages(l.settings, process.env)));' | tee /Users/yeongyu/local-workspaces/senpi/.omo/evidence/task-1-settings.log`
    Expected: stdout contains `"rb":false`
    Capture: the `tee` above
    Cleanup: `rm -rf /tmp/cm-qa1`; check: `test ! -d /tmp/cm-qa1 && echo CLEAN` prints CLEAN (append to evidence)
    Evidence: .omo/evidence/task-1-settings.log
  - Scenario: malformed codemode.json falls back to defaults with warning
    Tool: CLI stdout (node script)
    Steps: 1. `mkdir -p /tmp/cm-qa1b/.senpi && printf '{"languages":{"py":"yes"}}' > /tmp/cm-qa1b/.senpi/codemode.json` 2. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {loadCodemodeSettings} from "./packages/senpi-codemode/src/config/settings.ts"; const l = await loadCodemodeSettings({cwd:"/tmp/cm-qa1b"}); console.log(JSON.stringify({w: l.warnings.length > 0, py: l.settings.languages.py}));' | tee /Users/yeongyu/local-workspaces/senpi/.omo/evidence/task-1-settings-error.log`
    Expected: stdout contains `{"w":true,"py":true}`
    Capture: the `tee` above
    Cleanup: `rm -rf /tmp/cm-qa1b`; check: `test ! -d /tmp/cm-qa1b && echo CLEAN` prints CLEAN
    Evidence: .omo/evidence/task-1-settings-error.log
  **Commit**: Y | `feat(codemode): expand settings schema with taskTools/outputSink/statusEvents + SENPI_CODEMODE_* env flags` | Files: packages/senpi-codemode/src/config/settings.ts, packages/senpi-codemode/test/config.test.ts

- [ ] 2. Bridge protocol v2 — status frame + localRoots + artifactsDir
  **What to do**: In `packages/senpi-codemode/src/bridge/protocol.ts`: (a) add kernel→host frame `{type:"status", event: Record<string, unknown> & {op: string}}` to `kernelToHostMessageSchema` (op required, payload open — omp `JsStatusEvent` is `{op}&Record`, see reference); (b) extend the `init` frame's `connection` payload with optional `localRoots: Record<string,string>` and `artifactsDir: string` so kernels resolve `local://` paths and know the spill dir; (c) export an `EvalStatusEvent` type alias; (d) NEW `src/bridge/reserved.ts` — single source for cross-todo constants: `RESERVED_AGENT_TOOL = "__agent__"` (omp canon — js prelude.txt:111 calls `__omp_call_tool__("__agent__", …)`), `RESERVED_OUTPUT_TOOL = "__output__"` (codemode ADAPTATION — omp routes output() through `tool.read("agent://<id>")` which senpi lacks; this reserved kernel-side tool-call name is the substitute), both consumed by todos 6-8 kernels and 10/11 host bridges, `TIMEOUT_PAUSE_OP = "timeout-pause"`, `TIMEOUT_RESUME_OP = "timeout-resume"` (omp canon, oh-my-pi `src/eval/bridge-timeout.ts:19-22`). Decoder must treat missing new fields as absent (backward compatible — old kernels still decode). TDD: extend `packages/senpi-codemode/test/bridge-protocol.test.ts` FIRST — status frame round-trip, unknown-op passthrough, init with/without localRoots, oversized status frame rejected by existing 10MiB cap, reserved constants exported.
  **Must NOT do**: No breaking change to existing frame shapes (existing tests must stay green unmodified). No transport changes (http-server untouched beyond passing the new init fields through).
  **Parallelization**: Wave 1 | Blocks: 6,7,8,9,10,11 | Blocked by: none
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/bridge/protocol.ts:19-90` — current frame unions to extend; keep TypeBox `Type.Union` style and 10MiB `BRIDGE_FRAME_MAX_BYTES`.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/js/shared/types.ts:1-18` — `JsStatusEvent` shape being ported (`{op: string} & Record<string, unknown>`).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval-render.ts:106-121` — `upsertStatusEvent` coalescing contract the frame feeds (agent ops keyed by id replace; others append).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/extension/session-manager.ts:63-75` — where bridge init/connection config is built (plumb localRoots/artifactsDir here).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/bridge-protocol.test.ts` → exit 0 with new cases `status frame round-trip`, `init carries localRoots`.
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/` → 0 failures (no regression).
  **QA scenarios**:
  - Scenario: status frame decodes and re-encodes losslessly
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {decodeBridgeFrame, encodeBridgeFrame} from "./packages/senpi-codemode/src/bridge/protocol.ts"; const f = {type:"status", event:{op:"read", path:"/tmp/x", chars: 42}}; const d = decodeBridgeFrame(encodeBridgeFrame(f)); console.log(JSON.stringify(d));' | tee .omo/evidence/task-2-protocol.log`
    Expected: stdout contains `"ok":true` and `"op":"read"`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-2-protocol.log
  - Scenario: malformed status frame (missing op) rejected
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {decodeBridgeFrame} from "./packages/senpi-codemode/src/bridge/protocol.ts"; console.log(JSON.stringify(decodeBridgeFrame(JSON.stringify({type:"status", event:{}})+"\n")));' | tee .omo/evidence/task-2-protocol-error.log`
    Expected: stdout contains `"ok":false` and `"invalid_message"`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-2-protocol-error.log
  **Commit**: Y | `feat(codemode): bridge protocol v2 with status frames, reserved constants, local root propagation` | Files: packages/senpi-codemode/src/bridge/protocol.ts, packages/senpi-codemode/src/bridge/reserved.ts, packages/senpi-codemode/src/extension/session-manager.ts, packages/senpi-codemode/test/bridge-protocol.test.ts

- [ ] 3. Output infrastructure — TailBuffer + OutputSink port with session-adjacent spill
  **What to do**: Create `packages/senpi-codemode/src/output/streaming-output.ts` porting omp's `TailBuffer` and `OutputSink` (spillThreshold=DEFAULT_MAX_BYTES(50KB), headBytes, maxColumns clamp, onChunk throttle, dump()→OutputSummary{output,truncated,totalLines,totalBytes,outputLines,outputBytes,artifactId?}). Adaptations: (a) artifact target = caller-provided absolute file path (no artifact:// ids) — add `artifactNotice(path)` producing `[Full output: <path>]` instead of omp's artifact URI notice; (b) reuse `DEFAULT_MAX_BYTES/DEFAULT_MAX_LINES/truncateTail` re-exported from `@code-yeongyu/senpi` via existing `src/host-sdk.ts`; (c) add `resolveSessionArtifactsDir(sessionFile: string|undefined): {dir: string, temp: boolean}` — `<sessionFile minus .jsonl>-artifacts/` when a session file exists, else `os.tmpdir()/senpi-codemode-<random>/` (port shape from omp agent-bridge getArtifacts). Also create `src/output/output-meta.ts` port: `TruncationMeta`, `stripOutputNotice`, `formatTruncationWarning` (text-only; styled variant lands in todo 16). TDD FIRST: new `test/output/streaming-output.test.ts` — tail-window correctness across chunk boundaries, head+tail with gap notice, maxColumns clamping, spill file created only past threshold, dump idempotence; `test/output/output-meta.test.ts` — notice strip/format round-trip.
  **Must NOT do**: No Bun APIs (omp file uses Bun.write — use node:fs). No senpi core changes. No renderer imports (keep runtime/render layers split — omp learned this via a TDZ crash, see eval-render.ts:1-11 comment).
  **Parallelization**: Wave 1 | Blocks: 14,16 | Blocked by: none
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/session/streaming-output.ts:1-830` — source of TailBuffer/OutputSink/truncation helpers; port structure and constants (DEFAULT_MAX_LINES=3000, DEFAULT_MAX_BYTES=50KB, ARTIFACT_DEFAULT_HEAD_BYTES=3MiB) but strip artifact-id plumbing to plain paths.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/output-meta.ts:1-120` — TruncationMeta + notice helpers contract (resolveOutputSinkHeadBytes/resolveOutputMaxColumns read settings keys — map to todo 1's `outputSink` settings).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/host-sdk.ts:1` — existing re-export seam for senpi truncation utilities.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/agent-bridge.ts:210-216` — session-artifacts dir derivation being ported (sessionFile minus extension, tmp fallback).
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/core/bash-executor.ts:58-184` — senpi's existing spill-to-temp-file precedent (style reference for fs usage).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/output/` → exit 0, ≥10 assertions covering tail window, spill threshold, maxColumns, summary math.
  **QA scenarios**:
  - Scenario: 200KB stream spills to file, summary reports truncation
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {OutputSink} from "./packages/senpi-codemode/src/output/streaming-output.ts"; import * as os from "node:os"; import * as path from "node:path"; import * as fs from "node:fs"; const p = path.join(os.tmpdir(), "cm-qa3-spill.log"); const s = new OutputSink({artifactPath: p}); for (let i=0;i<2000;i++) s.push("x".repeat(100)+"\n"); const sum = await s.dump(); console.log(JSON.stringify({trunc: sum.truncated, total: sum.totalBytes, spilled: fs.existsSync(p) && fs.statSync(p).size > 100000}));' | tee .omo/evidence/task-3-outputsink.log`
    Expected: stdout contains `"trunc":true` and `"spilled":true`
    Capture: the `tee` above
    Cleanup: `rm -f "$TMPDIR/cm-qa3-spill.log" /tmp/cm-qa3-spill.log`; check: `node -e 'const os=require("os"),fs=require("fs"),p=require("path");console.log(fs.existsSync(p.join(os.tmpdir(),"cm-qa3-spill.log"))?"DIRTY":"CLEAN")'` prints CLEAN (append to evidence)
    Evidence: .omo/evidence/task-3-outputsink.log
  - Scenario: small output does not create spill file
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {OutputSink} from "./packages/senpi-codemode/src/output/streaming-output.ts"; import * as os from "node:os"; import * as path from "node:path"; import * as fs from "node:fs"; const p = path.join(os.tmpdir(), "cm-qa3b-spill.log"); const s = new OutputSink({artifactPath: p}); s.push("hello\n"); const sum = await s.dump(); console.log(JSON.stringify({trunc: sum.truncated, exists: fs.existsSync(p)}));' | tee .omo/evidence/task-3-outputsink-small.log`
    Expected: stdout contains `"trunc":false` and `"exists":false`
    Capture: the `tee` above
    Cleanup: none (asserts no file was created)
    Evidence: .omo/evidence/task-3-outputsink-small.log
  **Commit**: Y | `feat(codemode): port TailBuffer/OutputSink streaming output with session-adjacent spill` | Files: packages/senpi-codemode/src/output/streaming-output.ts, packages/senpi-codemode/src/output/output-meta.ts, packages/senpi-codemode/test/output/streaming-output.test.ts, packages/senpi-codemode/test/output/output-meta.test.ts

- [ ] 4. JSON tree renderer port
  **What to do**: Create `packages/senpi-codemode/src/tool/json-tree.ts` porting omp's `renderJsonTreeLines(value, theme, maxDepth, maxLines, scalarLen)` and its constants (`JSON_TREE_MAX_DEPTH_COLLAPSED/EXPANDED`, `JSON_TREE_MAX_LINES_COLLAPSED/EXPANDED`, `JSON_TREE_SCALAR_LEN_COLLAPSED/EXPANDED`). Adapt theming: omp `Theme.fg(color, text)` → senpi `Theme.fg(ThemeColor, text)` (same shape — verify color names used exist in senpi's ThemeColor union; substitute nearest for any missing, mapping documented in a comment). Theme parameter must accept `Theme | undefined` (plain-text fallback) matching existing render.ts style. TDD FIRST: new `test/json-tree.test.ts` — nested object/array indentation, depth cap with ellipsis, line cap with `truncated:true`, scalar truncation, undefined-theme plain output.
  **Must NOT do**: No imports from renderer-heavy modules (keep standalone). No senpi core changes.
  **Parallelization**: Wave 1 | Blocks: 16 | Blocked by: none
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/json-tree.ts:1-260` — full source being ported (structure, constants, truncation semantics).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/render.ts:1-100` — established theme-optional style (`style(theme, color, text)` helper) to match.
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/modes/interactive/theme/theme.ts` — senpi ThemeColor union (verify color names).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/json-tree.test.ts` → exit 0 with cases for depth cap, line cap, scalar truncation, plain fallback.
  **QA scenarios**:
  - Scenario: deep nested value renders capped tree
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {renderJsonTreeLines} from "./packages/senpi-codemode/src/tool/json-tree.ts"; const v = {a:{b:{c:{d:{e:{f:1}}}}}, list:[1,2,3]}; const r = renderJsonTreeLines(v, undefined, 3, 20, 40); console.log(JSON.stringify({lines: r.lines.length, truncated: r.truncated, first: r.lines[0]}));' | tee .omo/evidence/task-4-jsontree.log`
    Expected: stdout contains `"lines":` with value ≥3 and exit code 0
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-4-jsontree.log
  - Scenario: circular reference does not crash
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {renderJsonTreeLines} from "./packages/senpi-codemode/src/tool/json-tree.ts"; const v: any = {a:1}; v.self = v; const r = renderJsonTreeLines(v, undefined, 3, 20, 40); console.log("OK", r.lines.length);' | tee .omo/evidence/task-4-jsontree-error.log`
    Expected: stdout starts with `OK` (graceful cycle handling — match omp behavior; if omp source throws on cycles, port a depth-guard so this passes and document it)
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-4-jsontree-error.log
  **Commit**: Y | `feat(codemode): port JSON tree renderer for display() values` | Files: packages/senpi-codemode/src/tool/json-tree.ts, packages/senpi-codemode/test/json-tree.test.ts

- [ ] 5. Types v2 — EvalToolDetails/EvalCellResult/EvalStatusEvent expansion
  **What to do**: Extend `packages/senpi-codemode/src/tool/types.ts`: add `EvalStatusEvent = {op: string} & Record<string, unknown>`; `EvalDisplayOutput = {type:"json", data: unknown} | {type:"image", data: string, mimeType: string} | {type:"markdown", text: string} | {type:"status", event: EvalStatusEvent}`; `EvalCellResult = {index, title?, code, language, output, status: "pending"|"running"|"complete"|"error", exitCode?, durationMs?, statusEvents?, hasMarkdown?}`; expand `EvalToolDetails` to `{language, languages, title?, durationMs, toolCalls, truncated, isError?, phase?, cells: EvalCellResult[], statusEvents?: EvalStatusEvent[], jsonOutputs?: unknown[], notice?: string, meta?: TruncationMeta}` (superset of current — keep existing fields so render.ts compiles until todo 16). Port `upsertStatusEvent(events, event)` (agent-op coalescing by id) into a new `src/tool/status-events.ts`. TDD FIRST: `test/status-events.test.ts` — append vs coalesce semantics, first-seen order preserved, non-agent ops always append.
  **Must NOT do**: No behavior change to existing eval-tool.ts in this todo (types only + status-events module). No `budget` fields.
  **Parallelization**: Wave 1 | Blocks: 6,7,8,9,10,11,14,16 | Blocked by: none
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/types.ts:1-86` — current types to extend (TypeBox schema stays; details interface grows).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/types.ts:1-48` — omp's EvalCellResult/EvalToolDetails/EvalDisplayOutput shapes being ported.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval-render.ts:106-121` — upsertStatusEvent source (agent ops keyed by id coalesce in place; others append).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/status-events.test.ts` → exit 0.
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi && npm run check` → exit 0 (types compile across package).
  **QA scenarios**:
  - Scenario: agent progress events coalesce by id
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {upsertStatusEvent} from "./packages/senpi-codemode/src/tool/status-events.ts"; const evts: any[] = []; upsertStatusEvent(evts, {op:"agent", id:"a1", status:"running"}); upsertStatusEvent(evts, {op:"read", path:"/x"}); upsertStatusEvent(evts, {op:"agent", id:"a1", status:"completed"}); console.log(JSON.stringify({n: evts.length, s: evts[0].status}));' | tee .omo/evidence/task-5-types.log`
    Expected: stdout contains `{"n":2,"s":"completed"}`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-5-types.log
  - Scenario: non-agent duplicate ops append (no dedupe)
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {upsertStatusEvent} from "./packages/senpi-codemode/src/tool/status-events.ts"; const evts: any[] = []; upsertStatusEvent(evts, {op:"read", path:"/x"}); upsertStatusEvent(evts, {op:"read", path:"/x"}); console.log(evts.length);' | tee .omo/evidence/task-5-types-append.log`
    Expected: stdout is `2`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-5-types-append.log
  **Commit**: Y | `feat(codemode): expand eval detail types with cells/status events/display outputs` | Files: packages/senpi-codemode/src/tool/types.ts, packages/senpi-codemode/src/tool/status-events.ts, packages/senpi-codemode/test/status-events.test.ts

- [ ] 6. Python kernel parity — prelude helpers, status events, magics/shell escapes, display richness
  **What to do**: Bring `packages/senpi-codemode/src/kernels/py/prelude.py` (242 LOC) to parity with omp's Python surface (omp prelude.py 625 LOC + runner.py transform features): (a) helpers `env()`, `output()`, `agent()` (bridge tool-call to the reserved names from todo 2's `src/bridge/reserved.ts` — host side lands in todos 10/11; kernel side only marshals). agent() kernel signature ports omp EXACTLY incl. `isolated`/`apply`/`merge` kwargs (omp py prelude.py:426 — marshal them through; the HOST drops them with a warning, todo 10), keeping existing display/print/read/write/tool/completion/parallel/pipeline/log/phase; (b) status-event emission: read/write/env ops emit `{type:"status", event:{op, path?, chars?, ...}}` frames per todo 2 protocol (gated on `statusEvents` init flag); (c) `local://` path resolution in read/write via init-provided localRoots; (d) magic/shell-escape translation: port omp runner.py `transform_cell` line-scanner (`!cmd` → subprocess w/ streamed output, `%cd`/`%env` minimal magics) — omp's is dependency-free, copy the function structurally; (e) display richness: dict/list→JSON display (exists), add `_repr_png_`/`_repr_html_`/matplotlib-figure fallback chain and markdown display type per omp py/display.ts contract; (f) parallel() must pause/resume the idle window via the canonical `timeout-pause`/`timeout-resume` status ops from reserved.ts around bridge calls (pairs with todo 9). Interrupt semantics (SIGINT→KeyboardInterrupt, escalation) already exist — keep tests green. TDD FIRST: extend `test/py-kernel.test.ts` + new `test/py-prelude-parity.test.ts` (needs python3 on PATH; skip-if-absent guard matching existing py tests) — env get/set round-trip, `!echo hi` streams stdout, status frames arrive for read/write, local:// read resolves, markdown display frame emitted, agent() marshals a tool-call frame with name `__agent__`.
  **Must NOT do**: No `budget` helper. No IPython dependency (omp runner is dependency-free — keep it that way). No omp env-var names.
  **Parallelization**: Wave 2 | Blocks: 10,12,13,14,17 | Blocked by: 2,5
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/kernels/py/prelude.py:1-242` — current prelude (emit/display/tool/completion/parallel/pipeline already work; extend in place).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/py/prelude.py:1-625` — omp helper surface to port (env/output/agent signatures, kwargs conventions, docstrings).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/py/runner.py:273-420` — `transform_cell` magic/shell-escape scanner to port (structure + the `!`/`%` rules; skip In/Out history unless trivially portable).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/py/display.ts:1-71` — display bundle MIME contract (json/image/markdown precedence).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/bridge-timeout.ts:1-44` — EVAL_TIMEOUT_PAUSE_OP/RESUME_OP names and semantics (emitted around host-blocking bridge calls).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/py-kernel.test.ts` — existing python-optional test guards to reuse.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/py-prelude-parity.test.ts test/py-kernel.test.ts` → exit 0 (or explicit skip lines when python3 absent — CI has python3).
  - [ ] Prelude contains zero occurrences of `budget`: `test "$(grep -c budget packages/senpi-codemode/src/kernels/py/prelude.py || true)" = "0"` → exit 0 (grep -c alone exits 1 on zero matches).
  **QA scenarios**:
  - Scenario: real python kernel — shell escape + env + status frames
    Tool: CLI stdout (node script driving the real PythonKernel via bridge server)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --code '!echo SHELL_OK' --code 'env("QA_K", "V1"); print(env("QA_K"))' 2>&1 | tee .omo/evidence/task-6-py-parity.log` (todo also adds `scripts/qa-py-cell.ts`: boots bridge server + PythonKernel exactly like session-manager.ts does, runs each --code as a cell, prints all frames as JSON lines, then closes kernel+server)
    Expected: output contains `SHELL_OK`, then `V1`, and at least one `"type":"status"` line; process exits 0
    Capture: the `tee` above
    Cleanup: script closes kernel + bridge server; check: `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0 (append to evidence)
    Evidence: .omo/evidence/task-6-py-parity.log
  - Scenario: agent() without host handler errors cleanly (host wiring lands in todo 10)
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --code 'agent("do x")' 2>&1 | tee .omo/evidence/task-6-py-parity-error.log`
    Expected: a `"type":"result"` frame with `"ok":false` (or ok:true printing a bridged error string) mentioning `agent` unavailability — NOT a hang, NOT a kernel crash; exit 0
    Capture: the `tee` above
    Cleanup: same as happy path; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-6-py-parity-error.log
  **Commit**: Y | `feat(codemode): python kernel parity — env/output/agent helpers, status events, shell escapes, rich display` | Files: packages/senpi-codemode/src/kernels/py/prelude.py, packages/senpi-codemode/scripts/qa-py-cell.ts, packages/senpi-codemode/test/py-prelude-parity.test.ts, packages/senpi-codemode/test/py-kernel.test.ts

- [ ] 7. JS kernel parity — import rewriting, local modules, helpers, status events
  **What to do**: Bring the JS kernel (`src/kernels/js/*`) to omp parity: (a) create `src/kernels/js/rewrite-imports.ts` porting omp's Babel-based ESM rewrite (static `import` decls + dynamic `import()` → cwd-resolving helper; string/template/comment-safe) — add pinned `@babel/parser` dependency to senpi-codemode package.json (exact version, matching oh-my-pi's pin; per senpi AGENTS.md pin policy; no lifecycle scripts — parser is script-free); (b) port `local-module-loader.ts` (resolve `local://` + relative specifiers against session cwd/localRoots); (c) prelude/worker helpers parity with omp js/shared/prelude.txt + helpers.ts: `env()`, `output()`, `agent()` (options-object style; accepts `isolated`/`apply`/`merge` keys per omp allow-list js prelude.txt:102-109 and marshals them — host drops with warning), status-event emission for read/write/env ops using reserved.ts constants, markdown display; (d) worker receives localRoots/artifactsDir via workerData (init extension from todo 2). Existing run-queue/interrupt/inline-fallback stays. TDD FIRST: `test/js-rewrite-imports.test.ts` (port omp cases: top-level import forms, dynamic import, imports inside strings/comments untouched, `with {type:"json"}` attributes) + extend `test/js-kernel.test.ts` — env round-trip, `import fs from "node:fs"` works in a cell, status frames for write(), agent() marshals `__agent__` tool-call.
  **Must NOT do**: No Bun assumptions (Node worker_threads only). No `budget`. Keep `executionMode`-relevant behavior unchanged (queue semantics tests must stay green).
  **Parallelization**: Wave 2 | Blocks: 9,11,14,17 | Blocked by: 2,5
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/js/shared/rewrite-imports.ts:1-533` — Babel rewrite source (port structurally; keep the AST-node walk, drop pi-utils imports).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/js/shared/local-module-loader.ts:1-364` — local module resolution to port.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/js/shared/prelude.txt:1-293` and `helpers.ts:1-170` — helper definitions/signatures (JS options-object convention).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/kernels/js/worker-runtime.js:1-134`, `worker-core.js:1-89`, `context-manager.ts:1-290` — current worker pipeline to extend (keep contract with kernel-contract.ts).
  - `/Users/yeongyu/local-workspaces/senpi/AGENTS.md` — dependency pin + lockfile policy (`PI_ALLOW_LOCKFILE_CHANGE=1` needed for the @babel/parser add; plan the install command `npm install --ignore-scripts`).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/js-rewrite-imports.test.ts test/js-kernel.test.ts` → exit 0.
  - [ ] `node -e 'const p=require("/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/package.json"); console.log(p.dependencies["@babel/parser"])'` → prints an exact pinned version (no ^/~).
  **QA scenarios**:
  - Scenario: real JS cell imports node:fs and a relative file
    Tool: CLI stdout (node script)
    Steps: 1. `mkdir -p /tmp/cm-qa7 && printf 'export const V = 41;\n' > /tmp/cm-qa7/mod.mjs` 2. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-js-cell.ts --cwd /tmp/cm-qa7 --code 'import {V} from "./mod.mjs"; import * as fs from "node:fs"; console.log("IMPORT_OK", V + 1, typeof fs.readFileSync)' 2>&1 | tee .omo/evidence/task-7-js-parity.log` (todo adds `scripts/qa-js-cell.ts` symmetric to qa-py-cell.ts)
    Expected: output contains `IMPORT_OK 42 function`; exit 0
    Capture: the `tee` above
    Cleanup: `rm -rf /tmp/cm-qa7`; check `test ! -d /tmp/cm-qa7 && echo CLEAN` prints CLEAN
    Evidence: .omo/evidence/task-7-js-parity.log
  - Scenario: import inside a string literal is NOT rewritten
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {rewriteImports} from "./packages/senpi-codemode/src/kernels/js/rewrite-imports.ts"; const src = "const s = `import x from \\"y\\"`; console.log(s.length)"; const out = rewriteImports(src); console.log(JSON.stringify({unchanged: out.includes("import x from")}));' | tee .omo/evidence/task-7-js-parity-string.log`
    Expected: stdout contains `"unchanged":true`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-7-js-parity-string.log
  **Commit**: Y | `feat(codemode): js kernel parity — babel import rewriting, local modules, env/output/agent helpers, status events` | Files: packages/senpi-codemode/src/kernels/js/rewrite-imports.ts, packages/senpi-codemode/src/kernels/js/local-module-loader.ts, packages/senpi-codemode/src/kernels/js/{worker-runtime.js,worker-core.js,context-manager.ts,prelude.ts}, packages/senpi-codemode/package.json, packages/senpi-codemode/scripts/qa-js-cell.ts, packages/senpi-codemode/test/js-rewrite-imports.test.ts, packages/senpi-codemode/test/js-kernel.test.ts

- [ ] 8. Ruby + Julia kernel parity — helpers, status events, REPL auto-display polish
  **What to do**: Bring `src/kernels/rb/prelude.rb` (57 LOC vs omp 553) and `src/kernels/jl/prelude.jl` (79 LOC vs omp 735) + their runners to omp parity: helpers `env`, `output`, `agent` (keyword-arg conventions per language), status-event emission (read/write/env), `local://` resolution, markdown display type, and omp's REPL auto-display rules (rb: last expression displays unless nil/assignment/definition — IRB-like; jl: unless assignment/definition — REPL-like) with omp's exact suppression heuristics. Port any missing runner features from omp rb/runner.rb (581 LOC) and jl/runner.jl (666 LOC): streamed subprocess output, interrupt handling already covered by shared subprocess kernel — diff against omp and port gaps. TDD FIRST: extend `test/rb-kernel.test.ts` / `test/jl-kernel.test.ts` (interpreter-optional skip guards exist) — auto-display suppression matrix (assignment suppressed, literal displayed, nil suppressed), env round-trip, status frame on write, agent() marshals `__agent__`.
  **Must NOT do**: No `budget`. No new gem/Pkg dependencies (omp runners are stdlib-only — stay stdlib-only).
  **Parallelization**: Wave 2 | Blocks: 14,17 | Blocked by: 2,5
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/rb/prelude.rb:1-553` and `rb/runner.rb:1-581` — Ruby helper surface + auto-display suppression rules to port.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/jl/prelude.jl:1-735` and `jl/runner.jl:1-666` — Julia equivalents.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/kernels/shared/subprocess-kernel.ts:1-266` — shared lifecycle the runners plug into (do not fork it per language).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/kernels/rb/subprocess-kernel.test.ts` — existing rb test guards/style.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/rb-kernel.test.ts test/jl-kernel.test.ts` → exit 0 (or explicit interpreter-absent skips).
  **QA scenarios**:
  - Scenario: ruby auto-display matrix on a real interpreter (skip cleanly if `ruby -v` fails)
    Tool: CLI stdout (node script)
    Steps: 1. `ruby -v || echo SKIP_RB` 2. if present: `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-rb-cell.ts --code '1 + 1' --code 'x = 5' --code 'nil' 2>&1 | tee .omo/evidence/task-8-rbjl-parity.log` (todo adds qa-rb-cell.ts/qa-jl-cell.ts symmetric to qa-py-cell.ts)
    Expected: cell1 emits a display/result repr containing `2`; cell2 and cell3 emit NO auto-display frame; exit 0
    Capture: the `tee` above
    Cleanup: script closes kernel; check `pgrep -f 'senpi-codemode.*runner.rb' | wc -l` prints 0
    Evidence: .omo/evidence/task-8-rbjl-parity.log
  - Scenario: julia missing interpreter degrades to clear error (not hang)
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && PATH=/usr/bin:/bin npx tsx packages/senpi-codemode/scripts/qa-jl-cell.ts --code '1+1' 2>&1 | tee .omo/evidence/task-8-rbjl-error.log; echo "exit=$?" >> .omo/evidence/task-8-rbjl-error.log` (PATH stripped of julia)
    Expected: output contains a clear `No jl interpreter` (or equivalent availability) error within 15s; no orphan processes
    Capture: the `tee` above
    Cleanup: `pgrep -f runner.jl | wc -l` prints 0
    Evidence: .omo/evidence/task-8-rbjl-error.log
  **Commit**: Y | `feat(codemode): ruby/julia kernel parity — helpers, status events, REPL auto-display rules` | Files: packages/senpi-codemode/src/kernels/rb/{prelude.rb,runner.rb,kernel.ts}, packages/senpi-codemode/src/kernels/jl/{prelude.jl,runner.jl,kernel.ts}, packages/senpi-codemode/scripts/qa-rb-cell.ts, packages/senpi-codemode/scripts/qa-jl-cell.ts, packages/senpi-codemode/test/rb-kernel.test.ts, packages/senpi-codemode/test/jl-kernel.test.ts

- [ ] 9. Idle-timeout pause/resume wiring across the bridge
  **What to do**: Wire omp's bridge-timeout semantics end-to-end: kernels emit `{type:"status", event:{op: TIMEOUT_PAUSE_OP /* "timeout-pause" */}}` / `{op: TIMEOUT_RESUME_OP /* "timeout-resume" */}` — the canonical constants IMPORTED from todo 2's `src/bridge/reserved.ts` (omp canon, bridge-timeout.ts:19-22; no local aliases) — around every host-blocking bridge call (tool/completion/agent/output — emitted inside the prelude bridge shims from todos 6-8); host side (`src/tool/eval-tool.ts` CellExecution + `src/timeouts/idle-timeout.ts`) pauses the cell deadline on pause-op and restarts a FRESH window on resume-op (omp semantics: bridge time doesn't count toward the idle window; a fresh window starts after control returns). Filter these control ops OUT of user-visible statusEvents. `src/timeouts/bridge-timeout.ts` re-exports the reserved.ts constants for host-side consumers; do NOT port omp bridge-timeout.ts's docblock verbatim (it contains the word "budget", which the src/-wide Success-criteria grep bans). TDD FIRST: extend `test/timeouts.test.ts` + `test/eval-tool-interrupt.test.ts` — a cell whose bridge call takes 3× the timeout still completes (paused), compute after resume gets a fresh full window, pause/resume ops never appear in details.statusEvents.
  **Must NOT do**: No wall-clock `sleep` in tests (fake timers / short real windows ≤500ms). No competing fixed timer downstream (omp comment: watchdog drives the signal, backends never arm their own deadline — preserve).
  **Parallelization**: Wave 3 | Blocks: 14 | Blocked by: 2,5,7 (needs qa-js-cell.ts + worker plumbing from 7)
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/bridge-timeout.ts:1-44` — op names + withBridgeTimeoutPause helper semantics.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/idle-timeout.ts:1-91` — IdleTimeout pause/resume implementation to mirror.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval.ts:536-585` — host-side onStatus dispatch (pause→idle.pause(), resume→idle.resume(), else record) being ported.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/timeouts/{idle-timeout.ts,bridge-timeout.ts}` and `src/tool/eval-tool.ts:74-160` — current CellExecution deadline machinery to integrate with (startDeadline/clearDeadline already exist around kernel acquisition/reset).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/timeouts.test.ts test/eval-tool-interrupt.test.ts` → exit 0 including the new pause/resume cases.
  **QA scenarios**:
  - Scenario: slow bridged tool call outlives cell timeout without killing the cell
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-js-cell.ts --timeout-s 2 --slow-tool-ms 5000 --code 'const r = await tool.slow_fake({}); console.log("BRIDGE_OK", r.text)' 2>&1 | tee .omo/evidence/task-9-timeout.log` (qa-js-cell.ts from todo 7 gains a --slow-tool-ms flag registering a fake `slow_fake` executeTool that resolves after N ms)
    Expected: output contains `BRIDGE_OK`; no TimeoutError; exit 0
    Capture: the `tee` above
    Cleanup: script tears down worker; `pgrep -f worker-entry | wc -l` prints 0
    Evidence: .omo/evidence/task-9-timeout.log
  - Scenario: pure compute past timeout still dies
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-js-cell.ts --timeout-s 1 --code 'const t = Date.now(); while (Date.now() - t < 30000) {}' 2>&1 | tee .omo/evidence/task-9-timeout-kill.log; echo "exit=$?" >> .omo/evidence/task-9-timeout-kill.log`
    Expected: a timeout error result within ~5s wall (assert via script-printed elapsed < 10000ms in output); NOT a 30s run
    Capture: the `tee` above
    Cleanup: `pgrep -f worker-entry | wc -l` prints 0
    Evidence: .omo/evidence/task-9-timeout-kill.log
  **Commit**: Y | `feat(codemode): pause cell idle window during host bridge calls` | Files: packages/senpi-codemode/src/timeouts/{idle-timeout.ts,bridge-timeout.ts}, packages/senpi-codemode/src/tool/eval-tool.ts, packages/senpi-codemode/src/kernels/*/prelude.*, packages/senpi-codemode/test/timeouts.test.ts, packages/senpi-codemode/test/eval-tool-interrupt.test.ts

- [ ] 10. agent() host bridge — task-tool contract delegation
  **What to do**: Create `packages/senpi-codemode/src/bridges/agent-bridge.ts`. CellHandler routes kernel tool-calls named `__agent__` here (extend `src/tool/cell-handler.ts` dispatch alongside the existing `completion` special-case). Behavior: (a) parse args `{prompt (required, string>0), agent?, model?, label?, schema?, handle?, isolated?, apply?, merge?}` with TypeBox — invalid → structured tool-reply error; `isolated`/`apply`/`merge` are ACCEPTED but DROPPED with a synthesized `{op:"agent", id, status:"running", warning:"isolated/apply/merge unsupported (no isolation in task engine)"}` status event (omp kwargs exist, senpi-task has no isolation concept — documented divergence); (b) resolve task-tool name from settings (`taskTools.task`, default "task"); if absent from `ExecuteTool` availability (execute a capability probe via a new `isToolAvailable(name)` on the ExecuteTool seam — implemented by `pi.getActiveTools()` lookup in index.ts wiring), throw `agent() unavailable: no "task" tool is registered in this session` — the exact string tested; (c) map args → task params: `{prompt: schema? prompt+"\n\nRespond ONLY with JSON matching this JSON-Schema:\n"+JSON.stringify(schema) : prompt, subagent_type: agent (omit when undefined — engine default applies), model, name: label, run_in_background: handle === true}`; (d) call through the SAME ExecuteTool seam as other tools with the cell signal + onUpdate; (e) onUpdate → synthesize `{op:"agent", id, status, ...}` EvalStatusEvents defensively (unknown details shape → `{op:"agent", id: label ?? callId, status:"running"}` tick) pushed via todo 5's upsertStatusEvent into cell state and streamed to onUpdate; (f) result mapping: foreground → `{text}` (+ `data` = JSON.parse of text when schema given; parse failure → `{text, parseError}` not a throw); background/handle → `{text, id, handle: "agent://"+id}` where id is extracted from the task tool's returned text/details (`st_…` pattern + defensive details lookup); (g) recursion: document self-gating (senpi-task children lose task tools) in a comment — no depth counter. TDD FIRST: `test/agent-bridge.test.ts` with a FAKE task ToolDefinition (fixture returning canned AgentToolResult + emitting onUpdate ticks) — arg validation, absent-tool error string, schema prompt injection + JSON parse, handle extraction, onUpdate→statusEvent synthesis, abort propagation (signal aborts → bridge rejects, kernel gets error reply).
  **Must NOT do**: NO import of senpi-task/omo packages. No plan-mode gate (senpi has none — add `// omp assertNotPlanMode intentionally dropped: senpi has no plan mode` comment). No `budget` ceiling checks.
  **Parallelization**: Wave 3 | Blocks: 11,14,15,16,17 | Blocked by: 1,2,5,6 (QA uses qa-py-cell.ts from 6)
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/agent-bridge.ts:1-592` — omp source: arg schema (`agentArgsSchema` L50-60), spawn policy gating (L151-174 — replaced by task-tool presence), handle shape (`{text, output, handle:"agent://<id>", id, agent}`), structured-output prompt injection; port shapes, replace task/executor calls with executeTool("task").
  - `/Users/yeongyu/local-workspaces/omo/packages/senpi-task/src/tools/task/params.ts:1-27` — target task tool contract (prompt/subagent_type/run_in_background/name/model) — contract reference ONLY, never imported.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/cell-handler.ts:96-160` — existing special-case dispatch (completion, recursive-eval guard) to extend; reuse marshalToolResult.
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/core/extensions/types.ts:1627-1634` — ExecuteToolOptions {signal, onUpdate} + error codes the bridge must map.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/eval/fakes.ts` — existing fake ExecuteTool style for tests.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-bridge.test.ts` → exit 0, ≥8 cases as listed.
  - [ ] Import-form guard: `grep -nE "(from|require\()\s*['\"]@oh-my-opencode" packages/senpi-codemode/src/bridges/agent-bridge.ts | wc -l` → 0 (comments MAY mention senpi-task; imports may not).
  **QA scenarios**:
  - Scenario: real py cell spawns agent() against a fake task tool end-to-end
    Tool: CLI stdout (node script; real python kernel + bridge + fake task tool)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --with-fake-task --code 'r = agent("summarize x"); print("AGENT_OK", r["text"])' 2>&1 | tee .omo/evidence/task-10-agent.log` (qa-py-cell.ts gains --with-fake-task: registers a fake "task" tool returning `{content:[{type:"text",text:"FAKE_RESULT"}]}` and emitting 2 onUpdate ticks)
    Expected: output contains `AGENT_OK FAKE_RESULT` and ≥1 `"op":"agent"` status frame line; exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-10-agent.log
  - Scenario: agent() with no task tool registered errors with the documented message
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --code 'agent("x")' 2>&1 | tee .omo/evidence/task-10-agent-error.log`
    Expected: output contains `agent() unavailable: no "task" tool is registered in this session`; kernel stays alive (a follow-up `--code 'print(1+1)'` in the same invocation prints 2)
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-10-agent-error.log
  **Commit**: Y | `feat(codemode): agent() bridge delegating to registered task tools` | Files: packages/senpi-codemode/src/bridges/agent-bridge.ts, packages/senpi-codemode/src/tool/cell-handler.ts, packages/senpi-codemode/scripts/qa-py-cell.ts, packages/senpi-codemode/test/agent-bridge.test.ts

- [ ] 11. output() host bridge — task_output delegation
  **What to do**: Create `packages/senpi-codemode/src/bridges/output-bridge.ts` handling kernel tool-calls named `RESERVED_OUTPUT_TOOL` ("__output__", from todo 2 reserved.ts — a codemode ADAPTATION: omp's output() reads `agent://<id>` via its internal-URL read tool, which senpi lacks): args `{ids: string[] (≥1), format?: "raw"|"tail", offset?, limit?}` — single id → scalar string, multiple → list of strings (omp return-shape contract from py prelude.py:118-230); omp's `format:"json"|"stripped"` and `query` are DROPPED (task engine owns transcripts; no omp metadata exists) — documented divergence. Delegate each id to `executeTool(settings.taskTools.output /* "task_output" */, {task_id: id, mode: format === "tail" ? "tail" : "full", block: true}, {signal})` — the REAL senpi-task contract (`task_id ?? name` required; default mode:"status" returns a snapshot NOT a transcript, so mode is always sent explicitly); ids that look like names (no `st_` prefix) are sent as `{name: id, ...}` instead. Absent tool → `output() unavailable: no "task_output" tool is registered in this session`. Map result text through marshalToolResult; apply offset/limit as 1-indexed line slicing on the returned transcript text. Route in cell-handler next to `__agent__`. TDD FIRST: `test/output-bridge.test.ts` with a fake task_output fixture that VALIDATES incoming params against the real TaskOutputParams shape (rejects `{to}`, requires `task_id|name` + explicit `mode`) — single vs multi id shapes, st_-vs-name routing, mode mapping (raw→full, tail→tail), line offset/limit slicing, absent-tool error, abort propagation.
  **Must NOT do**: NO senpi-task import. No caching layer (omp AgentOutputManager's artifact caching is skipped — task engine owns transcripts; document divergence in a comment).
  **Parallelization**: Wave 3 | Blocks: 14,17 | Blocked by: 1,2,5,7,10 (qa-js-cell.ts from 7; cell-handler.ts dispatch edited after 10)
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/py/prelude.py:118-230` and `js/shared/prelude.txt:78-91` — omp output() return-shape contract (single→scalar, multi→list) and its `agent://` read mechanism we replace.
  - `/Users/yeongyu/local-workspaces/omo/packages/senpi-task/src/tools/output/output.ts:14-60` — REAL task_output contract: `{task_id?, name?, mode?: "status"|"tail"|"full", tail_lines?, block?, timeout_ms?}`, `runTaskOutput` requires `task_id ?? name`, default mode returns a snapshot — reference ONLY, never imported.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/cell-handler.ts:96-160` — dispatch seam.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/output-bridge.test.ts` → exit 0.
  **QA scenarios**:
  - Scenario: js cell retrieves fake task output by id
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-js-cell.ts --with-fake-task --code 'const o = await output("st_123"); console.log("OUTPUT_OK", o.slice(0,20))' 2>&1 | tee .omo/evidence/task-11-output.log` (--with-fake-task also registers a fake "task_output" that ASSERTS params carry `task_id` (or `name`) + explicit `mode`, rejects a `to` key, and echoes `TRANSCRIPT:<task_id>:<mode>`)
    Expected: output contains `OUTPUT_OK TRANSCRIPT:st_123:full`; exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f worker-entry | wc -l` prints 0
    Evidence: .omo/evidence/task-11-output.log
  - Scenario: output() for unknown id surfaces the task engine's error text (not a crash)
    Tool: CLI stdout (node script)
    Steps: 1. same driver with fake task_output throwing `ToolError("unknown task st_999")`: `npx tsx packages/senpi-codemode/scripts/qa-js-cell.ts --with-fake-task --code 'try { await output("st_999_missing") } catch (e) { console.log("ERR_OK", String(e).includes("unknown task")) }' 2>&1 | tee .omo/evidence/task-11-output-error.log` (fixture treats ids containing "missing" as unknown)
    Expected: output contains `ERR_OK true`; exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f worker-entry | wc -l` prints 0
    Evidence: .omo/evidence/task-11-output-error.log
  **Commit**: Y | `feat(codemode): output() bridge delegating to task_output` | Files: packages/senpi-codemode/src/bridges/output-bridge.ts, packages/senpi-codemode/src/tool/cell-handler.ts, packages/senpi-codemode/test/output-bridge.test.ts

- [ ] 12. completion() v2 — schema + model tiers
  **What to do**: Extend `src/completion/handler.ts` + `src/completion/tool-bridge.ts` to omp parity: `completion(prompt, model?="default", system?=None, schema?=None)`. (a) `schema`: when provided, append the JSON-Schema instruction to the prompt (same injection helper as todo 10 — extract shared `injectSchemaInstruction(prompt, schema)` into `src/bridges/schema-injection.ts`), parse the reply into a structured object, return parse errors as data not throws; (b) `model` tiers: "default" = session model (current behavior), "smol"/"slow" = resolve via `ctx.modelRegistry` — pick cheapest/most-capable available model by cost metadata; unresolvable tier → clear error naming the tier. Update all four preludes' completion() signatures (already accept opts — verify schema/model plumb through the bridge frames). TDD FIRST: extend `test/completion-handler.test.ts` — schema injection text, structured parse success + failure shape, tier resolution with a fake modelRegistry, unknown tier error.
  **Must NOT do**: No live API calls in tests (fake complete()). No new provider config surface.
  **Parallelization**: Wave 3 | Blocks: 17 | Blocked by: 1,5,6 (QA uses qa-py-cell.ts from 6; adds its --with-fake-completion flag)
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/completion/handler.ts:1-123` — current single-shot completion path to extend.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/completion-bridge.ts:1-211` — omp schema/model-tier semantics being ported.
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/core/extensions/types.ts:331-388` — ExtensionContext.modelRegistry/model access for tier resolution.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/completion-handler.test.ts` → exit 0 with schema + tier cases.
  **QA scenarios**:
  - Scenario: py cell completion(schema=...) returns parsed dict via fake completer
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --with-fake-completion '{"name":"senpi","stars":5}' --code 'r = completion("describe repo", schema={"type":"object"}); print("SCHEMA_OK", r["name"], r["stars"])' 2>&1 | tee .omo/evidence/task-12-completion.log` (qa driver gains --with-fake-completion returning the given canned text)
    Expected: output contains `SCHEMA_OK senpi 5`; exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-12-completion.log
  - Scenario: malformed JSON reply under schema surfaces parse-failure data
    Tool: CLI stdout (node script)
    Steps: 1. same driver with `--with-fake-completion 'not json at all'` and `--code 'r = completion("x", schema={"type":"object"}); print("PARSE_FAIL_OK", "parseError" in r or isinstance(r, str))'`; tee to evidence
    Expected: output contains `PARSE_FAIL_OK True`; exit 0
    Capture: `... | tee .omo/evidence/task-12-completion-error.log`
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-12-completion-error.log
  **Commit**: Y | `feat(codemode): completion schema output + smol/slow model tiers` | Files: packages/senpi-codemode/src/completion/{handler.ts,tool-bridge.ts}, packages/senpi-codemode/src/bridges/schema-injection.ts, packages/senpi-codemode/src/kernels/*/prelude.*, packages/senpi-codemode/scripts/qa-py-cell.ts (adds --with-fake-completion), packages/senpi-codemode/test/completion-handler.test.ts

- [ ] 13. Concurrency parity — parallel()/pipeline() pool semantics
  **What to do**: Verify + port omp's concurrency-bridge contract into the kernels' parallel()/pipeline(): pool width from settings `parallelPoolWidth` (todo 1 plumbs it via bridge init), input-order preservation, lowest-index error propagation after all settled (omp semantics: a throwing thunk propagates but the wave finishes), pipeline stage barriers (every item clears stage N before any enters N+1). Diff each prelude implementation against omp's (py prelude ThreadPoolExecutor / js Promise pool / rb/jl equivalents) and port gaps. TDD FIRST: extend per-kernel tests (`test/py-kernel.test.ts`, `test/js-kernel.test.ts`, rb/jl) — order preservation with jittered thunk durations, error propagation index, pipeline barrier (stage-2 start times all ≥ max stage-1 end time; assert via timestamps captured in-cell).
  **Must NOT do**: No unbounded pools. No new settings keys beyond parallelPoolWidth.
  **Parallelization**: Wave 3 | Blocks: 17 | Blocked by: 1,5,6 (QA uses qa-py-cell.ts from 6)
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/concurrency-bridge.ts:1-34` — pool width constant + contract.
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/py/prelude.py` (parallel/pipeline section) and `js/shared/prelude.txt` — reference semantics (order, error index, barriers).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/kernels/py/prelude.py:17` — existing ThreadPoolExecutor usage to align.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/py-kernel.test.ts test/js-kernel.test.ts` → exit 0 including new parallel/pipeline cases.
  **QA scenarios**:
  - Scenario: py parallel() preserves order under jitter
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-py-cell.ts --code 'import time, random\ndef mk(i):\n    def f():\n        time.sleep(random.random()*0.2)\n        return i\n    return f\nprint("ORDER_OK", parallel([mk(i) for i in range(8)]) == list(range(8)))' 2>&1 | tee .omo/evidence/task-13-parallel.log`
    Expected: output contains `ORDER_OK True`; exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-13-parallel.log
  - Scenario: throwing thunk propagates lowest-index error
    Tool: CLI stdout (node script)
    Steps: 1. same driver, `--code 'def boom():\n    raise ValueError("idx2")\ntry:\n    parallel([lambda: 0, lambda: 1, boom])\nexcept ValueError as e:\n    print("ERR_OK", "idx2" in str(e))'`; tee to evidence
    Expected: output contains `ERR_OK True`; exit 0
    Capture: `... | tee .omo/evidence/task-13-parallel-error.log`
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-13-parallel-error.log
  **Commit**: Y | `feat(codemode): parallel/pipeline pool-width, ordering, and barrier parity` | Files: packages/senpi-codemode/src/kernels/*/prelude.*, packages/senpi-codemode/src/extension/session-manager.ts, packages/senpi-codemode/test/{py-kernel.test.ts,js-kernel.test.ts,rb-kernel.test.ts,jl-kernel.test.ts}

- [ ] 14. eval-tool core v2 — OutputSink integration, live tail, images, narrowing re-registration, disposal tracking
  **What to do**: Rework `src/tool/eval-tool.ts` + `src/tool/cell-handler.ts` + `src/index.ts` to omp's execute() architecture: (a) route ALL kernel text/log/display output through an OutputSink (todo 3) with artifactPath from `resolveSessionArtifactsDir` + settings headBytes/maxColumns; live-tail attribution via per-cell TailBuffer (omp activeLiveCell pattern) so onUpdate streams the running cell's output; (b) build `EvalToolDetails` v2: cells[] (single-cell array — schema stays single-cell), statusEvents, jsonOutputs (display JSON values), notice, meta (TruncationMeta from sink summary); (c) image pipeline: display image frames → `resizeImage` + `formatDimensionNote` from `@code-yeongyu/senpi`, WebP exclusion for models whose id matches omp's exclusion predicate (port `webpExclusionForModel` logic keyed on ctx.model), dimension notes appended to text; (d) exit-code/cancel result paths (cancelled → isError details + partial output; kernel error → error status + output); (e) **narrowing re-registration**: `src/index.ts` session_start handler re-calls `pi.registerTool(createEvalTool(...))` AFTER settings + interpreter availability + task-tool presence resolve — schema narrowed to enabled languages (`createEvalInputSchema`), description re-rendered with enabled languages + spawns flag (todo 15's template), replacing the load-time registration (which stays as the pre-session fallback); (f) disposal safety: port `trackEvalExecution`-equivalent into `SessionManagerProxy` — session_shutdown/before_switch/before_fork awaits or aborts in-flight eval executions before disposing kernels (omp `assertEvalExecutionAllowed` analog: post-disposal execute() throws CodemodeSessionDisposedError); (g) keep proxy-executor seam: `createEvalTool(options)` accepts optional `proxyExecutor` (omp EvalProxyExecutor shape) short-circuiting execute — for RPC-mode embedders and tests. TDD FIRST: extend `test/eval-tool.test.ts` + new `test/eval-tool-output.test.ts` — sink-backed truncation details, live-tail onUpdate ordering, image resize called for display images (fake), narrowed schema after simulated session_start (assert description lacks disabled languages AND execute rejects them), disposal aborts in-flight cell, proxyExecutor bypass.
  **Must NOT do**: No multi-cell schema (omp is single-cell; cells[] is a rendering detail). No `budget`. No renderer imports in eval-tool.ts (TDZ guard — renderers import types only).
  **Parallelization**: Wave 4 | Blocks: 15,16,17,18 | Blocked by: 1,3,5,6,7,8,9,10,11
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval.ts:395-768` — omp execute() architecture being ported: OutputSink wiring (L511-528), activeLiveCell (L470-486), image pipeline (L595-640), cancel/exit-code paths (L655-712), summarizeFinal (L744-768).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/utils/image-resize.ts:1-60` — resize contract; senpi already exports `resizeImage`/`formatDimensionNote` (`packages/coding-agent/src/index.ts:397`) — use those, port only `webpExclusionForModel` (from `src/utils/image-loading.ts` in oh-my-pi).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/eval-tool.ts:160-269` and `src/index.ts:33-56` — current runEvalCell + registration flow being reworked; CellExecution/CellKernel abort machinery is KEPT.
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/core/extensions/loader.ts:290-296` + `agent-session.ts:3144-3177` — re-registration replace semantics (Map.set by name + refreshTools) this todo relies on.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/extension/session-manager.ts:100-140` — dispose/generation machinery to extend with execution tracking.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/eval-tool.test.ts test/eval-tool-output.test.ts test/extension.test.ts` → exit 0.
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi && npm run check` → exit 0.
  **QA scenarios**:
  - Scenario: full extension pipeline — narrowed schema + spilled output through createAgentSession
    Tool: CLI stdout (node driver through the REAL extension pipeline)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && SENPI_CODING_AGENT_DIR=$(mktemp -d) SENPI_CODEMODE_RB=0 SENPI_CODEMODE_JL=0 npx tsx packages/senpi-codemode/scripts/qa-e2e-eval.ts 2>&1 | tee .omo/evidence/task-14-core.log` (todo adds `scripts/qa-e2e-eval.ts`: createAgentSession() loading the codemode extension EXPLICITLY as an inline/path extension — pass the extension factory from `packages/senpi-codemode/src/index.ts` via the SDK's extension seam (InlineExtension / resourceLoader extension path, see `packages/coding-agent/src/core/sdk.ts:102-115` exports incl. `InlineExtension`), NOT via bundled discovery — fires session_start, then (1) prints the registered eval tool's description language list, (2) executeTool("eval", {language:"js", code:"for(let i=0;i<3000;i++)console.log('L'+i)"}), prints details.meta truncation + artifact file existence, (3) executeTool("eval",{language:"rb",…}) expecting rejection)
    Expected: output contains `LANGS: py,js` (rb/jl absent), `TRUNCATED: true`, `SPILL_EXISTS: true`, and `RB_REJECTED: true`; exit 0
    Capture: the `tee` above
    Cleanup: script disposes session (kernels+bridge down) and rm -rf its temp agent dir; check `pgrep -f worker-entry | wc -l` prints 0
    Evidence: .omo/evidence/task-14-core.log
  - Scenario: mid-cell abort preserves kernel state for next cell
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-e2e-eval.ts --abort-scenario 2>&1 | tee .omo/evidence/task-14-core-abort.log` (--abort-scenario: cell1 sets `x=42`; cell2 `while True: pass` aborted via signal after 500ms; cell3 prints x)
    Expected: cell2 result isError/cancelled; cell3 output contains `42` (python kernel survived interrupt); exit 0
    Capture: the `tee` above
    Cleanup: script teardown; `pgrep -f 'senpi-codemode.*prelude' | wc -l` prints 0
    Evidence: .omo/evidence/task-14-core-abort.log
  **Commit**: Y | `feat(codemode): eval core v2 — output sink, live tail, image pipeline, session-narrowed registration, disposal tracking` | Files: packages/senpi-codemode/src/tool/{eval-tool.ts,cell-handler.ts}, packages/senpi-codemode/src/index.ts, packages/senpi-codemode/src/extension/session-manager.ts, packages/senpi-codemode/src/tool/image.ts, packages/senpi-codemode/scripts/qa-e2e-eval.ts, packages/senpi-codemode/test/{eval-tool.test.ts,eval-tool-output.test.ts,extension.test.ts}

- [ ] 15. Prompt v2 — spawns gating, examples, senpi wording, guideline parity
  **What to do**: Update `src/prompt/eval-prompt.ts` template to full omp eval.md parity minus budget: (a) add template context flags `spawns: boolean` (task tool present) + `spawnDefaultAgent?: string` — `agent()`/`output()` prelude entries and the `<dag>` section render only when spawns=true (port omp's `{{#if spawns}}` blocks verbatim, adapted names); (b) embed the reuse-chain examples (omp EvalTool.ALL_EXAMPLES) as a trailing `<examples>` block in the description, filtered by enabled languages (senpi ToolDefinition lacks an examples field — description embedding is the parity mechanism, note in comment); (c) `output()` prelude line (omp signature); (d) keep Node wording for js; (e) NO `budget` line anywhere. Update `buildEvalPrompt(enabled)` signature → `buildEvalPrompt(enabled, {spawns, spawnDefaultAgent})`. TDD FIRST: update `test/prompt.test.ts` snapshots — spawns on/off variants, examples filtered by language, zero `budget` occurrences asserted explicitly (regression guard), guidelines list parity.
  **Must NOT do**: No `budget`, no `+Nk` ceiling text. No omp-brand names (PI_*, artifact://) in prompt text — name real senpi paths/behavior.
  **Parallelization**: Wave 4 | Blocks: 17,18 | Blocked by: 10,14
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/prompts/tools/eval.md:1-72` — source template (instruction/prelude/dag/critical sections; spawns conditionals).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval.ts:312-355` — ALL_EXAMPLES content to embed.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/prompt/eval-prompt.ts:17-100` — template + micro-engine ({{#if}}/{{#ifAll}}/{{#ifAny}}) to extend.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/__snapshots__/prompt.test.ts.snap` — snapshot file to regenerate deliberately.
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/prompt.test.ts` → exit 0.
  - [ ] `node -e 'const {buildEvalPrompt} = require("/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/prompt/eval-prompt.ts")' 2>/dev/null; cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {buildEvalPrompt} from "./packages/senpi-codemode/src/prompt/eval-prompt.ts"; const p = buildEvalPrompt({py:true,js:true,rb:false,jl:false},{spawns:true,spawnDefaultAgent:"task"}); console.log(p.description.includes("agent(") && !p.description.includes("budget") ? "PROMPT_OK" : "PROMPT_BAD");'` → prints `PROMPT_OK`.
  **QA scenarios**:
  - Scenario: spawns=false hides agent()/output()/dag
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {buildEvalPrompt} from "./packages/senpi-codemode/src/prompt/eval-prompt.ts"; const p = buildEvalPrompt({py:true,js:true,rb:false,jl:false},{spawns:false}); console.log(JSON.stringify({agent: p.description.includes("agent("), dag: p.description.includes("<dag>")}));' | tee .omo/evidence/task-15-prompt.log`
    Expected: stdout contains `{"agent":false,"dag":false}`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-15-prompt.log
  - Scenario: examples filtered to enabled languages
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx -e 'import {buildEvalPrompt} from "./packages/senpi-codemode/src/prompt/eval-prompt.ts"; const p = buildEvalPrompt({py:false,js:true,rb:false,jl:false},{spawns:false}); console.log(JSON.stringify({hasRuby: p.description.includes("require "), hasPyImport: p.description.includes("import json")}));' | tee .omo/evidence/task-15-prompt-filter.log`
    Expected: stdout contains `{"hasRuby":false,"hasPyImport":false}`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-15-prompt-filter.log
  **Commit**: Y | `feat(codemode): prompt parity — spawns gating, embedded examples, output() docs` | Files: packages/senpi-codemode/src/prompt/eval-prompt.ts, packages/senpi-codemode/test/prompt.test.ts, packages/senpi-codemode/test/__snapshots__/prompt.test.ts.snap

- [ ] 16. Render v2 — framed highlighted cells, status lines, agent progress, JSON tree
  **What to do**: Rework `src/tool/render.ts` to omp eval-render parity on senpi's Component contract: (a) code block rendered with `highlightCode(code, lang)` from `@code-yeongyu/senpi` (py/js/rb/jl → highlighter lang mapping per omp `languageForHighlighter`); (b) per-cell header: status icon (running=spinner via context.spinnerFrame, done=✓success, error=✗error), language badge, title, duration (`formatDuration` port), reset/timeout badges; (c) status-event lines: port omp `formatStatusEvent` op→icon/summary mapping (read/write/cat/ls/env/git_*/run/completion/log/phase) as plain themed lines under the output block, collapsed to last N when not expanded; (d) agent-progress rows: port `renderAgentProgressEvents` — one row per coalesced `op:"agent"` event (icon by status, id bold, currentTool/lastIntent line while running, duration when terminal) using text tree glyphs (`└`/`├` literals — senpi Theme has no tree tokens; document); (e) `display()` JSON values via todo 4's json-tree, labeled `display[i]` when >1; (f) truncation warning from details.meta via output-meta helpers; (g) keep PlainTextComponent + width-safe reflow via `truncateToVisualLines` (existing); expanded mode shows full code/output; images: existing `[image: mime]` fallback stays, and when `context.showImages && imageProtocol` senpi's ToolExecutionComponent shell renders result images — verify no double-print (renderShell default). TDD FIRST: extend the six existing eval-render test files (`test/eval-render*.test.ts`) — highlighted-code snapshot (strip-ANSI compare), status-line formatting matrix, agent-row states (running/completed/failed), json-tree embedding, truncation warning line, spinner frame advance, width reflow with CJK text (existing helpers).
  **Must NOT do**: No imports from eval-tool.ts runtime (types only — TDZ guard). No senpi core/tui changes. No removal of existing render tests — extend them.
  **Parallelization**: Wave 4 | Blocks: 17,18 | Blocked by: 3,4,5,10,14
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/tools/eval-render.ts:44-777` — source renderer: languageForHighlighter (L44-49), upsert/agent progress (L106-260), formatStatusEvent op matrix (L262-420), cell framing + preview windows (L560-777).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src/tool/render.ts:1-267` — current PlainTextComponent renderer to extend (style(), renderAllVisualLines, toolCallRows stay).
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/index.ts:383-392` — highlightCode/Theme/ThemeColor exports available to the extension.
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/eval-render-fixtures.ts` — existing fixture style for render tests.
  - `/Users/yeongyu/local-workspaces/senpi/packages/coding-agent/src/core/export-html/tool-renderer.ts:99-110` — HTML export consumes this same renderCall/renderResult (ANSI→HTML); keep output ANSI-clean (theme.fg only).
  **Acceptance criteria**:
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npx tsx ../../node_modules/vitest/dist/cli.js --run test/eval-render.test.ts test/eval-render-streaming.test.ts test/eval-render-theme.test.ts test/eval-render-width.test.ts test/eval-render-preview.test.ts test/eval-render-state.test.ts` → exit 0.
  **QA scenarios**:
  - Scenario: happy-path render dump — highlighted cell + status lines + agent row + json tree
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-render-dump.ts --fixture success 2>&1 | tee .omo/evidence/task-16-render-happy.log` (qa-render-dump.ts --fixture success: complete py cell, title "load config", 2 status events (read+write), 1 completed agent event, 1 jsonOutput, no truncation; prints renderEvalCall+renderEvalResult .render(100) ANSI-stripped)
    Expected: output contains a highlighted header line matching `eval py load config done`, a `read` status line with char count, an agent row containing `done` or `✓`, and an indented json-tree line; would FAIL against current render.ts (no status/agent/tree rendering exists there)
    Capture: the `tee` above
    Cleanup: none (read-only fixture)
    Evidence: .omo/evidence/task-16-render-happy.log
  - Scenario: renderResult snapshot for an error cell with status events + agent rows
    Tool: CLI stdout (node script)
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && npx tsx packages/senpi-codemode/scripts/qa-render-dump.ts --fixture error --width 40 2>&1 | tee .omo/evidence/task-16-render-dump.log` (todo adds qa-render-dump.ts: --fixture error builds an AgentToolResult with details{cells:[error cell whose output contains CJK text "한글출력테스트"], statusEvents:[read,write,agent(completed)], jsonOutputs:[{a:1}], meta:{truncated}}; prints renderEvalResult(...).render(40) ANSI-stripped, PLUS a `MAXWIDTH:<n>` line = max visual column across lines)
    Expected: output contains the error header matching `eval py .* error`, a `read` status line, an agent row containing `✓` or `done`, a `display[1]`-labeled tree line, a truncation warning line, AND `MAXWIDTH:` ≤ 40 (CJK-safe reflow at narrow width)
    Capture: the `tee` above
    Cleanup: none (read-only fixture)
    Evidence: .omo/evidence/task-16-render-dump.log
  **Commit**: Y | `feat(codemode): render parity — syntax highlighting, status lines, agent progress, json tree` | Files: packages/senpi-codemode/src/tool/render.ts, packages/senpi-codemode/scripts/qa-render-dump.ts, packages/senpi-codemode/test/eval-render*.test.ts, packages/senpi-codemode/test/eval-render-fixtures.ts

- [ ] 17. Test-parity sweep — every applicable omp eval test has a counterpart
  **What to do**: Build the parity ledger and close it: enumerate ALL omp eval test files (src/eval/__tests__/*: agent-bridge(1418L), completion-bridge(412), js-context-manager(291), prelude-agent(107), kernel-spawn(103), idle-timeout(80), budget-bridge(80—SKIP, budget excluded), bridge-timeout(64), julia-prelude(66), helpers-local-roots(55); src/eval/py/__tests__/{prelude,runner-shell-output}; test/tools/eval-*.test.ts: display-text, fallback, streaming-output, timeout, agent-progress, code-preview, commit-stability, description; test/eval/: agent-bridge, console-table, display-image-coerce, process-stdio-capture, runtime-global-dispose, worker-core; test/core/eval-workflow-helpers.integration.test.ts). Re-run `ls` on all four omp test dirs FIRST — this list is the minimum, the ls output is canonical. For each: map to an existing senpi-codemode test (todos 1-16 created most) or PORT the missing cases now into the matching test file. Produce `packages/senpi-codemode/test/PARITY.md` — a table omp-test → senpi-test → status (ported/covered/skipped+reason). Only allowed skip reasons: budget (user-excluded), omp-infra-specific (artifact:// ids, plan mode, Bun-runtime specifics) — each with one-line justification. TDD nature: this todo IS tests; any behavioral gap it finds gets fixed in the owning module within this todo.
  **Must NOT do**: No test deletion/weakening to force parity. No `it.skip` without a PARITY.md row.
  **Parallelization**: Wave 4 | Blocks: 18,F | Blocked by: 6,7,8,9,10,11,12,13,14,15,16
  **References**:
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/src/eval/__tests__/` and `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/test/tools/` — source test inventory (list above; read each before mapping).
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/` — target suite (36 existing files).
  - `/Users/yeongyu/local-workspaces/oh-my-pi/packages/coding-agent/test/tools/eval-commit-stability.test.ts` — subtle regression class worth porting exactly (details stability across streaming updates).
  **Acceptance criteria**:
  - [ ] `test -f /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/test/PARITY.md && grep -c "| skipped" packages/senpi-codemode/test/PARITY.md` → every skipped row's reason cell non-empty (manual-free check: `! grep -E "\| skipped \|\s*\|" test/PARITY.md`).
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npm test` → full suite green.
  **QA scenarios**:
  - Scenario: full suite run is green and deterministic (two consecutive runs)
    Tool: CLI stdout
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npm test 2>&1 | tail -5 | tee /Users/yeongyu/local-workspaces/senpi/.omo/evidence/task-17-suite-run1.log && npm test 2>&1 | tail -5 | tee -a /Users/yeongyu/local-workspaces/senpi/.omo/evidence/task-17-suite-run1.log`
    Expected: both runs end with 0 failed; identical pass counts (no flakes)
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-17-suite-run1.log
  - Scenario: parity ledger completeness spot-check
    Tool: CLI stdout
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && for f in agent-bridge completion-bridge bridge-timeout idle-timeout kernel-spawn helpers-local-roots console-table display-image-coerce process-stdio-capture runtime-global-dispose worker-core eval-workflow-helpers; do grep -q "$f" packages/senpi-codemode/test/PARITY.md && echo "OK $f" || echo "MISSING $f"; done | tee .omo/evidence/task-17-parity-check.log`
    Expected: twelve `OK` lines, zero `MISSING`
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-17-parity-check.log
  **Commit**: Y | `test(codemode): omp eval test-parity sweep + ledger` | Files: packages/senpi-codemode/test/PARITY.md, packages/senpi-codemode/test/** (ported cases)

- [ ] 18. Docs + packaging — README, AGENTS.md, CHANGELOG, dependency hygiene
  **What to do**: (a) Rewrite `packages/senpi-codemode/README.md`: current text says the extension factory is a no-op — replace with accurate feature docs (4 kernels, helper table incl. agent()/output() task-tool gating, settings reference incl. new keys + SENPI_CODEMODE_* flags, spill-file behavior, divergences from omp: no budget, no artifact://, task-engine delegation); (b) update `packages/senpi-codemode/AGENTS.md` STRUCTURE/QUALITY GATES for new dirs (src/output, src/bridges, scripts/qa-*); (c) `packages/senpi-codemode/CHANGELOG.md` Unreleased entries per conventions in `.github/agent/commands/cl.md` (Added: status events, agent/output bridges, output sink, render parity, import rewriting; Changed: prompt/schema narrowing at session start); (d) dependency hygiene: verify `@babel/parser` pinned exactly, `npm install --ignore-scripts` lockfile refresh with `PI_ALLOW_LOCKFILE_CHANGE=1` documented in the commit body, regenerate `packages/coding-agent/publish-deps.lock.json` via `node scripts/generate-coding-agent-shrinkwrap.mjs` ONLY IF the coding-agent shrinkwrap actually references codemode deps (check first; if untouched, record that); (e) fork-tracking: append a summary to `packages/senpi-codemode/changes.md` if the file exists, else note the port provenance in CHANGELOG.
  **Must NOT do**: No version bump, no release. No edits to released changelog sections. No coding-agent source changes (shrinkwrap regen is a generated artifact, allowed only if diff shows codemode-dep entries).
  **Parallelization**: Wave 4 (last) | Blocks: F | Blocked by: 14,15,16,17
  **References**:
  - `/Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/{README.md,AGENTS.md,CHANGELOG.md,package.json}` — files to update (README's "no-op" claim is stale — fix).
  - `/Users/yeongyu/local-workspaces/senpi/.github/agent/commands/cl.md` — changelog rules (never edit released sections).
  - `/Users/yeongyu/local-workspaces/senpi/AGENTS.md` (root) — lockfile + shrinkwrap policy being followed.
  **Acceptance criteria**:
  - [ ] `grep -c "no-op" /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/README.md` → 0.
  - [ ] `git -C /Users/yeongyu/local-workspaces/senpi diff --check` → exit 0 (docs whitespace clean).
  - [ ] `cd /Users/yeongyu/local-workspaces/senpi && npm run check` → exit 0.
  **QA scenarios**:
  - Scenario: docs mention every new settings key
    Tool: CLI stdout
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && for k in taskTools outputSink statusEvents SENPI_CODEMODE_PY; do grep -q "$k" packages/senpi-codemode/README.md && echo "OK $k" || echo "MISSING $k"; done | tee .omo/evidence/task-18-docs.log`
    Expected: four `OK` lines
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-18-docs.log
  - Scenario: changelog audit passes format rules
    Tool: CLI stdout
    Steps: 1. `cd /Users/yeongyu/local-workspaces/senpi && git diff --stat -- packages/senpi-codemode/CHANGELOG.md | tee .omo/evidence/task-18-docs-cl.log && grep -A2 "## \[Unreleased\]" packages/senpi-codemode/CHANGELOG.md | head -5 >> .omo/evidence/task-18-docs-cl.log`
    Expected: diff touches ONLY the Unreleased section (verify: `git diff packages/senpi-codemode/CHANGELOG.md | grep "^-" | grep -v "^---" | wc -l` prints 0 — no deletions from released sections)
    Capture: the `tee` above
    Cleanup: none (read-only)
    Evidence: .omo/evidence/task-18-docs-cl.log
  **Commit**: Y | `docs(codemode): full-port documentation, changelog, dependency hygiene` | Files: packages/senpi-codemode/{README.md,AGENTS.md,CHANGELOG.md,package.json}, package-lock.json (workspace refresh only)

## Final Verification Wave
> Runs in parallel after ALL todos. Each reviewer returns APPROVE or REJECT.
> Any REJECT -> fix -> re-run only the rejecting reviewer. Surface results in
> the final report; completion is declared by the executor's final quality
> gate, not by user approval. Pause only for input the user alone can provide.

- [ ] F1. Plan compliance audit - read the plan end-to-end; verify every Must
  Have exists (read file / run command), every Must NOT Have is absent
  (grep `budget` across src/ → zero hits; grep import-form `@oh-my-opencode` across src/ → zero hits; `git diff --stat packages/coding-agent packages/tui scripts/release.mjs` → empty), every evidence file exists.
- [ ] F2. Code quality review - `npm run check` from repo root green; full
  `npm test` in packages/senpi-codemode green; review changed files for
  `as any` / empty catches / debug prints / dead code / slop.
- [ ] F3. Real manual QA - from clean state, execute EVERY QA scenario from
  EVERY todo plus cross-task integration (js cell defines → py cell independent →
  js cell reuses; agent() with fake task tool → output() retrieval; kill -9 a
  kernel mid-cell → next cell recovers) plus the senpi-qa regression channels
  (`node .agents/skills/senpi-qa/scripts/tui-smoke.mjs --self-test --driver tmux`
  and `node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test` both green);
  save evidence to .omo/evidence/final-qa/
  and copy to local-ignore/qa-evidence/<YYYYMMDD>-codemode-port/.
- [ ] F4. Scope fidelity check - per todo, diff spec vs actual changes: nothing
  missing, nothing beyond spec, no cross-task contamination, no unaccounted files
  (`git status --short` names only senpi-codemode paths + plan/evidence).

## Commit strategy
- Per todo, after its tests + QA pass: `feat(codemode): <summary>` staging ONLY that todo's files (`git add <explicit paths>`; never `git add -A`).
- Todo 18 additionally: `docs(codemode): …` for README/AGENTS/CHANGELOG.
- Pre-commit for every commit: `cd packages/senpi-codemode && npm test` green + `npm run check` green at root.

## Success criteria

### Verification commands
```bash
cd /Users/yeongyu/local-workspaces/senpi && npm run check
# Expected: exit 0

cd /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode && npm test
# Expected: all vitest files pass, 0 failures

grep -rn "budget" /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src | wc -l
# Expected: 0  (all of src/ — tests excluded: PARITY.md legitimately names omp's skipped budget tests)

grep -rnE "(from|require\()\s*['\"]@oh-my-opencode" /Users/yeongyu/local-workspaces/senpi/packages/senpi-codemode/src | wc -l
# Expected: 0  (import-form only; comments may reference senpi-task by name)

git -C /Users/yeongyu/local-workspaces/senpi diff --stat -- packages/coding-agent packages/tui scripts/release.mjs
# Expected: empty output (zero core changes)
```

### Final checklist
- [ ] All Must Have present
- [ ] All Must NOT Have absent
- [ ] All QA evidence captured under .omo/evidence/
