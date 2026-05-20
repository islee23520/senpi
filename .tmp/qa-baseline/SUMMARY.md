# QA Baseline — senpi-neo-tui pre-rewrite (HEAD `c5e3b72e`)

Captured 2026-05-19 against the staged binary at
`packages/coding-agent/dist/neo-tui-bin/senpi-neo-tui-darwin-arm64` (post-`npm run build:neo-tui`).

## Bug 1 — Shift+Enter in tmux SUBMITS instead of newline

**Repro**:
```
tmux new-session -d -s qa-bug1 -x 80 -y 20
$NEO_BIN  # in tmux pane
# type: first-line
# press: shift+enter
# type: second-line
```

**Observed**:
- After `first-line` typed: buffer shows `› first-line▏`, footer `· ready`.
- After `shift+enter` + `second-line` typed: buffer shows `› second-line▏` (first-line vanished), footer `⠢ waiting`.

**Expected**: buffer multi-line `first-line\nsecond-line`, footer stays `· ready`.

**Cause**: Rust crossterm with `DISAMBIGUATE_ESCAPE_CODES` flag does NOT emit
xterm modifyOtherKeys mode 2 (`\x1b[>4;2m`) when running inside tmux, so the
tmux server collapses `Shift+Enter` to plain `Enter`.

**TS fix landed at `c5e3b72e`** (for `senpi` legacy TUI): emit `\x1b[>4;2m`
on startup if `TMUX` env detected, parse CSI-u `\x1b[13;2u` as `shift+enter`.

**Wave 0B + 3A address this**.

---

## Bug 2 — Korean input truncated at right edge (single-line input)

**Repro**:
```
tmux new-session -d -s qa-wrap -x 60 -y 20
$NEO_BIN  # in tmux pane
# type 30 Korean chars: 가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노
```

**Observed**:
- Input box is single-line, fixed height.
- 30 Korean × 2 cells = 60 cells, but box inner width is ~55. The trailing chars
  `퍼허고노` (4 chars) are CLIPPED OFF the right edge with no scroll indicator.
- Pressing Home moves cursor to start; the truncation window does not slide —
  Home + X yields `X가나다...퍼` STILL TRUNCATED, last few chars still hidden.

**Expected**: either word-wrap to multiple lines (preferred, matches pi-tui TS)
OR horizontal scroll that follows the cursor with a visible indicator.

**Wave 1A (editor rewrite with word-wrap display) addresses this**.

---

## Bug 3 — Silent failure / no timeout / no error after submit

**Repro**:
```
$NEO_BIN  # idle
# type: hello world
# press: Enter
# wait 8+ seconds
```

**Observed**:
- Submit succeeds, chat shows `› you hello world ...`.
- Footer changes to `⠤ waiting   ctx 0% │ 0↓ 0↑` (animated spinner + zero metrics).
- After 8s: still `⠢ waiting` with all-zero metrics. No assistant bubble appears.
  No error message. No timeout. No connection indicator. Forever.

**Expected**: if backend is not reachable / not configured, surface error to
the chat area + footer, and/or display a "no backend" hint after a short
timeout. User must know whether the request is in flight or failed.

**Wave 3B (RPC error handling) + Wave 2C (footer state hierarchy) + Wave 2D
(header connection indicator) address this**.

---

## Bug 4 — Idle vs answering state look too similar

**Observed**:
- Idle: ` · ready` footer, no extra info.
- Answering: ` ⠤ waiting   ctx 0% │ 0↓ 0↑` footer with spinner + USELESS zero metrics.

**Expected**: distinct visual treatment beyond a one-glyph swap. OpenCode-style:
distinct footer background tint per state (warm-amber for thinking, green for
streaming, red for error), lock indicator on input when answering, clearer
status label, hide metrics when they are all zero / inapplicable.

**Wave 4A (status bar visual hierarchy) addresses this**.

---

## Acceptance after rewrite

For each of the 4 bugs above, the rewrite MUST:
1. Add a TDD-locked regression test that fails on the current code.
2. Implement the fix.
3. Reproduce the bug scenario above in tmux against the new binary; capture
   pane; confirm the bug is gone.
4. Save the post-fix capture next to this file as `bug{N}-fixed.log`.
