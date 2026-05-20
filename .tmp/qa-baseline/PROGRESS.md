# QA Progress — Wave 3 complete

## Bug status as of HEAD `654373ac`

| Bug | Status | Wave |
|-----|--------|------|
| 1. shift+enter in tmux SUBMITS instead of newline | FIXED | 1A editor + default keymap |
| 2. Korean input visually truncated at right edge | FIXED | 1A word-wrap display |
| 3. Silent failure / no timeout / no error after submit | EVENTS LANDED, UI NOT WIRED | 3B done, needs 4D consumer |
| 4. Idle vs answering state look too similar | FIXED | 2C footer state hierarchy |

## New features delivered in Wave 3
- @path autocomplete popup with file suggestions
- History navigation via Up/Down on empty buffer
- Mouse wheel chat scroll
- Model picker overlay
- Theme picker overlay
- TerminalCaps integration (tmux modifyOtherKeys)
- RPC error events surfaced from client

## Tests
285 passing (was 156 at branch start).

## Up next
- Wave 4D: consume Inbound::Error/Disconnected in app (FIXES BUG 3)
- Wave 4A: anim system polish
- Wave 4B: theme token audit
- Wave 4E: docs + CHANGELOG
- Wave 5: full QA + PR + Oracle + merge
