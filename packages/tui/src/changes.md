# TUI delta rendering fork changes

## 2026-05-10: viewport remap repaint fix for Ctrl-O expansion

### What changed

- In `packages/tui/src/tui.ts` `TUI.doRender()`, above-viewport growth that remaps `viewportTop` now repaints only the visible viewport rows in place under synchronized output instead of falling back to a post-init full replay path.
- The repaint path deletes only kitty images in the previously visible viewport slice before rewriting rows, preserving image cleanup without clearing scrollback.
- In `packages/tui/test/tui-render.test.ts`, the above-viewport expansion regression now also asserts no raw `\x1b[2J`/`\x1b[3J` appears and verifies visible expanded rows are repainted while DECSET 2026 remains balanced.

### Why this cannot be expressed externally

The decision point depends on internal renderer bookkeeping (`prevViewportTop`, `viewportTop`, `hardwareCursorRow`, kitty image ID tracking, and synchronized write boundaries). Extensions/components can trigger renders but cannot replace this internal fallback behavior or safely rewrite only viewport rows at this stage.

### Expected upstream conflict zone

- `packages/tui/src/tui.ts` around the `firstChanged < prevViewportTop` branch inside `doRender()` (viewport remap handling and fallback path).
- `packages/tui/test/tui-render.test.ts` in `TUI viewport remap for above-viewport growth` assertions.

## What changed

- Tighten `TUI.doRender()` fallback paths so streaming updates can stay on the differential renderer instead of clearing the full screen when unchanged visible viewport rows are stable.
- Keep synchronized output (`DECSET 2026`) balanced around every differential write path.
- Add flicker-budget regression tests for synthetic streaming workloads in `packages/tui/test/tui-render.test.ts`.

## Why this cannot be expressed externally

The fallback decisions live inside `TUI.doRender()` and depend on private renderer state: `previousLines`, viewport offsets, terminal dimensions, cursor row tracking, and the line-diff window. Extension hooks and components can request renders, but they cannot override the internal decision to call `fullRender(true)` or wrap terminal writes with synchronized output.

Component-level caching is added in coding-agent components because high-frequency assistant/tool updates rebuild render trees during streaming. External extensions can register alternate renderers, but they cannot memoize the built-in assistant and tool execution components without replacing core interactive-mode rendering.

## Expected upstream conflict zones

- `packages/tui/src/tui.ts`: `TUI.doRender()` fallback branches around width/height changes, `clearOnShrink`, deleted-line handling, viewport-shift handling, and synchronized output writes.
- `packages/tui/src/tui.ts`: `fullRender` paths and `fullRedrawCount` accounting.
- `packages/coding-agent/src/modes/interactive/components/assistant-message.ts`: assistant streaming render cache.
- `packages/coding-agent/src/modes/interactive/components/tool-execution.ts`: tool execution streaming render cache.
- `packages/coding-agent/src/modes/interactive/interactive-mode.ts`: streaming render request audit comments near `message_update` and `tool_execution_update`.

## Test surface added

- `flicker budget under streaming` in `packages/tui/test/tui-render.test.ts` verifies:
  - full clear sequence count stays at the initial render only,
  - ANSI escape bytes remain below the content-byte budget,
  - every `DECSET 2026` begin has a matching end,
  - no `fullRender(true)` equivalent clear occurs after the init phase.
