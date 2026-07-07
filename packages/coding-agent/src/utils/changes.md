# changes

## Shell resolution for persistent terminals (2026-07-07)

### What changed

- `shell.ts`: `getShellConfig` honors `SENPI_GIT_BASH_PATH` (checked before Windows Git-Bash
  probing) and resolves an explicit shell path by KIND — `cmd.exe` → `/c`, PowerShell/pwsh →
  `-NoProfile -Command`, bash/sh → `-c`/`-s`. New exports: `resolveShellKind`, `GIT_BASH_PATH_ENV`,
  `ShellKind`, and a `kind` field on `ShellConfig`.

### Why

- The persistent-terminal builtin (`terminal`) resolves the shell + args + transport via this
  helper and passes them into `@earendil-works/pi-pty`, so non-bash shells (cmd, PowerShell)
  and a user-pinned Git Bash spawn correctly on Windows.

### Why extension system couldn't handle this

- Shell resolution is a core utility shared by `core/tools/bash.ts` and the terminal extension.

### Expected merge conflict zones on next upstream sync

- LOW: `getShellConfig` resolution order and `ShellConfig` shape.

## Senpi-branded outbound identity (2026-05-11)

### What changed

- `core/sdk.ts`: `getProviderHeaders()` no longer hardcodes `"pi"` / `"pi-coding-agent"`. The OpenRouter `X-OpenRouter-Title` and the Cloudflare `User-Agent` now interpolate the runtime `APP_NAME` from `config.ts` (`"senpi"` in this fork).

### Why

- Every outbound request should identify as senpi, not pi. Hardcoded `"pi"` strings broke that contract.

### Why extension system couldn't handle this

- These are core SDK internals; an extension cannot rewrite headers built by `core/sdk.ts`.

### Expected merge conflict zones on next upstream sync

- LOW: provider-header builder.

## Senpi version metadata lookup (2026-05-02)

### What changed

- `version-check.ts`: Latest-version checks now query the configured senpi package metadata from npm instead of pi.dev.
- `pi-user-agent.ts`: The update-check user agent now uses the runtime app name from package metadata.

### Why

- `senpi update` and startup update checks must compare against senpi releases, not upstream pi-mono releases.

### Why extension system couldn't handle this

- Startup version checks run from core utilities before extensions can intercept the fetch target.

### Expected merge conflict zones on next upstream sync

- LOW: version-check URL and user-agent formatting utilities.
