# Codex app-server protocol

This directory vendors the TypeScript protocol generated from `codex-cli 0.142.5`.

Generated source:

```bash
codex app-server generate-ts --experimental --out src/modes/app-server/protocol/generated
```

The generated tree was copied verbatim from:

```text
.omo/ulw-research/20260702-114518/raw/schema-ts-experimental
```

Do not hand-edit files under `generated/`. Update them with
`packages/coding-agent/scripts/generate-app-server-protocol.sh` when the pinned
Codex protocol version changes.

The generated `.ts` files intentionally remain byte-for-byte identical to the
research artifact. They are raw upstream protocol evidence, not app-facing build
input: `ts-rs` generated extensionless sibling imports are incompatible with
this package's Node16/NodeNext ESM compilation strategy. The package build
excludes `generated/**/*.ts`, and root typechecking only tolerates the raw tree
because `generated/package.json` marks that subtree as CommonJS without changing
any generated TypeScript bytes. Keep app-facing protocol imports out of
`generated/**`; use the non-generated facade instead.

The non-generated `index.ts` facade avoids importing the raw generated tree
directly while still providing typed app-facing protocol shapes for the
initialize, thread, turn, model-list, server-notification, and server-request
surfaces used by later app-server work.
