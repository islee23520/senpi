# Codex app-server protocol

This directory vendors the TypeScript protocol fixture from Codex git commit
`0fb559f0f6e231a88ac02ea002d3ecd248e2b515` (author date 2026-07-18).

Generated source:

```bash
packages/coding-agent/scripts/generate-app-server-protocol.sh \
  --from-checkout /Users/yeongyu/local-workspaces/codex
```

Checkout mode recursively copies this Codex-maintained fixture verbatim, deletes
files no longer present upstream, preserves only the local `generated/package.json`
compilation shim, and derives `PROTOCOL_VERSION.txt` from the checkout's HEAD SHA
and author date:

```text
/Users/yeongyu/local-workspaces/codex/codex-rs/app-server-protocol/schema/typescript
```

Do not hand-edit files under `generated/`. Update them with
`packages/coding-agent/scripts/generate-app-server-protocol.sh` when the pinned
Codex protocol version changes.

The generated `.ts` files intentionally remain byte-for-byte identical to the
research artifact. The extra `generated/package.json` file is a local build shim
and is not part of upstream payload identity. The generated TypeScript is raw
upstream protocol evidence, not app-facing build input: `ts-rs` generated
extensionless sibling imports are incompatible with this package's
Node16/NodeNext ESM compilation strategy. The package build excludes
`generated/**/*.ts`, and root typechecking only tolerates the raw tree because
the shim marks that subtree as CommonJS without changing any generated
TypeScript bytes. Keep app-facing protocol imports out of `generated/**`; use
the non-generated facade instead.

The non-generated `index.ts` facade avoids importing the raw generated tree
directly while still providing typed app-facing protocol shapes for the
initialize, thread, turn, model-list, server-notification, and server-request
surfaces used by later app-server work.
