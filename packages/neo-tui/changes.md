# changes.md — packages/neo-tui

This crate is net-new vs upstream `badlogic/pi-mono`. It exists only in the senpi fork.

## 2026-05-18 — Initial scaffold

- Created the workspace member `packages/neo-tui/` under the senpi monorepo.
- Workspace Cargo.toml at repo root introduces a Rust workspace alongside the existing TypeScript packages.
- The binary is built by `packages/neo-tui/scripts/build-binary.mjs` and copied into `packages/coding-agent/dist/neo-tui-bin/`.
- Activated only when the user passes `senpi --neo`. Zero impact on existing senpi behavior when the flag is absent.
- Talks to senpi over the existing `senpi --mode rpc` JSONL protocol (see `packages/coding-agent/docs/rpc.md`). No new RPC surface.

Upstream rebase notes: this directory does not exist upstream. Conflict surface is limited to the four touched files in `packages/coding-agent/` (args.ts, main.ts, modes/index.ts, package.json) which are tracked in `packages/coding-agent/src/cli/changes.md`.
