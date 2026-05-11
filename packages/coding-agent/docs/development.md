# Development

See [AGENTS.md](../../../AGENTS.md) at the monorepo root for fork-specific guidelines (`changes.md` contract, extension-first philosophy, tab indent / 120 width, etc.).

## Setup

```bash
git clone https://github.com/code-yeongyu/senpi
cd senpi
npm install
npm run build
```

Run from source:

```bash
/path/to/senpi/pi-test.sh
```

The script can be run from any directory. Senpi keeps the caller's current working directory.

## Forking / Rebranding

This repo is itself a rebrand of upstream `pi-mono` to `senpi`. The runtime identity (CLI name, config dir, env var prefix) is configured via `package.json`:

```json
{
  "piConfig": {
    "name": "senpi",
    "configDir": ".senpi"
  }
}
```

Change `name`, `configDir`, and `bin` field for your fork. Affects CLI banner, config paths, and environment variable names.

## Path Resolution

Three execution modes: npm install, standalone binary (`bun build --compile`), tsx from source.

**Always use `src/config.ts`** for package assets:

```typescript
import { getPackageDir, getThemeDir } from "./config.js";
```

Never use `__dirname` directly for package assets.

## Debug Command

`/debug` (hidden) writes to `~/.senpi/agent/senpi-debug.log`:
- Rendered TUI lines with ANSI codes
- Last messages sent to the LLM

## Testing

```bash
npm test            # Vitest across workspaces (skips live-API; default test runner)
./pi-test.sh        # Live-API integration suite (env-gated; requires API keys)
npm run check       # Biome + tsgo + browser-smoke + web-ui check (pre-commit equivalent)
```

Run a specific test:

```bash
npm test --workspace @code-yeongyu/senpi -- test/specific.test.ts
```

## Project Structure

```
packages/
  ai/           # @earendil-works/pi-ai — LLM provider abstraction
  agent/        # @earendil-works/pi-agent-core — Agent loop and message types
  tui/          # @earendil-works/pi-tui — Terminal UI components
  coding-agent/ # @code-yeongyu/senpi — CLI and interactive mode (this package)
  web-ui/       # @earendil-works/pi-web-ui — Lit chat components
```

See the monorepo root [AGENTS.md](../../../AGENTS.md) for the full task → location map.
