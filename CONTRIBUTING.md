# Contributing to senpi

senpi is an opinionated fork of [badlogic/pi-mono](https://github.com/badlogic/pi-mono). This guide covers the fork-specific contribution rules. For the upstream contribution culture, see pi-mono's [CONTRIBUTING.md](https://github.com/badlogic/pi-mono/blob/main/CONTRIBUTING.md).

## The One Rule

**You must understand your code.** If you cannot explain what your changes do and how they interact with the rest of the system, your PR will be closed.

Using AI to write code is fine. Submitting AI-generated slop without understanding it is not.

If you use an agent, run it from the senpi repo root directory so it picks up `AGENTS.md` automatically. Your agent must follow the rules and guidelines in that file and in the nearest subdirectory `AGENTS.md`.

## Fork Strategy (READ BEFORE EDITING `src/`)

senpi periodically rebases on `upstream/main` (i.e. `badlogic/pi-mono`). To keep rebases clean:

1. **Extension-first** — every new feature lands as a builtin extension under `packages/coding-agent/src/core/extensions/builtin/`, or as a user extension under `packages/coding-agent/examples/extensions/`. Touch `core/` only when no extension hook can do the job.
2. **`changes.md` contract** — any modification to an upstream-tracked file MUST add a section to the nearest `changes.md` documenting *what changed, why, why an extension couldn't handle it, and expected merge-conflict zones*. See the existing files for templates.
3. **Skim the relevant `AGENTS.md`** in the directory you are about to modify. It tells you which patterns are load-bearing.

## Before Submitting a PR

```bash
npm run check     # Biome + tsgo + browser-smoke + web-ui check (pre-commit equivalent)
npm test          # Vitest across workspaces (skips live-API)
./pi-test.sh      # Optional: live-API integration suite (env-gated; requires API keys)
```

`npm run check` and `npm test` must pass. `./pi-test.sh` is only required when your change touches a provider that the live tests exercise.

Do not edit `CHANGELOG.md`. Changelog entries are added by maintainers.

If you are adding a new provider to `packages/ai`, see [`packages/ai/src/providers/AGENTS.md`](packages/ai/src/providers/AGENTS.md) for the 7-step checklist and required cross-provider tests.

## Quality Bar for Issues

If you open an issue:

- Keep it concise. If it does not fit on one screen, it is too long.
- State the bug or request clearly.
- Explain why it matters.
- Include a repro (minimal reproduction or exact command + observed vs expected).
- If you want to implement the change yourself, say so.

## Philosophy

senpi's core stays minimal. Most "this could be a feature" requests should be implemented as extensions ([`packages/coding-agent/src/core/extensions/builtin/`](packages/coding-agent/src/core/extensions/builtin/AGENTS.md) for in-tree, [`packages/coding-agent/examples/extensions/`](packages/coding-agent/examples/extensions/) for external).

If your change must modify upstream-tracked source:

1. Confirm no extension hook covers it (read [docs/extensions.md](packages/coding-agent/docs/extensions.md)).
2. Add a `changes.md` section before sending the PR.

PRs that bloat the core or skip `changes.md` will be asked to convert to an extension or document the modification.

## Style

- TAB indent (Biome `indentWidth: 3`). 120-column line width.
- Match the style of the surrounding file. The codebase is largely consistent — Biome plus the existing patterns are the source of truth.
- Use the path aliases defined in root `tsconfig.json` (`@earendil-works/pi-*`, `@code-yeongyu/senpi*`).

## Communication

- Issue and PR discussion happens on GitHub: <https://github.com/code-yeongyu/senpi>.
- Upstream pi-mono discussions: <https://discord.com/invite/3cU7Bz4UPx>.
