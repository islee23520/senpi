# packages/web-ui

`@earendil-works/pi-web-ui` — Lit web components + Tailwind v4 chat UI. Built on `@mariozechner/mini-lit`. Used as a starter UI shell; not bundled into senpi CLI.

## STRUCTURE

```
src/
├── ChatPanel.ts                 # Top-level component
├── app.css                      # Hand-maintained source CSS (Tailwind v4 imports + custom rules); built to dist/app.css
├── index.ts                     # Public component exports
├── components/                  # AgentInterface, MessageList, Messages, Input, ConsoleBlock,
│                                # ThinkingBlock, StreamingMessageContainer, AttachmentTile,
│                                # SandboxedIframe, MessageEditor, CustomProviderCard,
│                                # ProviderKeyInput, ExpandableSection,
│                                # message-renderer-registry.ts, sandbox/
├── dialogs/                     # Modal dialogs: SettingsDialog, SessionListDialog,
│                                # ApiKeyPromptDialog, AttachmentOverlay, CustomProviderDialog,
│                                # ModelSelector, PersistentStorageDialog, ProvidersModelsTab
├── storage/                     # IndexedDB-backed app/session storage
│   ├── app-storage.ts
│   ├── store.ts
│   ├── types.ts
│   ├── backends/                # IndexedDB backend
│   └── stores/                  # Per-domain stores
├── tools/                       # In-browser tools: javascript-repl, extract-document,
│                                # renderer-registry.ts, renderers/, artifacts/, types.ts
├── prompts/                     # Default prompts
└── utils/                       # Shared helpers

example/                         # Standalone demo app (own npm project, not a workspace)
```

## WHERE TO LOOK

| Task | File |
|------|------|
| Add a new chat component | `src/components/` (extend `LitElement`, register via `@customElement`) |
| Wire a new in-browser tool | `src/tools/` + `tools/index.ts` re-export |
| Render a custom message type | register in `components/message-renderer-registry.ts` |
| Add an artifact renderer | `src/tools/artifacts/` |
| Persist app data | `src/storage/stores/` |
| Run dev | `npm run dev` (concurrent: tsc watch + tailwind watch + example dev server) |

## CONVENTIONS

- **Compiler is `tsc` (NOT tsgo)**. Reason: this package uses legacy `experimentalDecorators` for Lit (`@customElement`/`@property`); the build config (`tsconfig.build.json`) enables `experimentalDecorators` only and does not emit decorator metadata.
- **CSS pipeline**: Tailwind v4 reads `src/app.css`, emits `dist/app.css`. Source CSS contains the Tailwind/theme imports plus custom rules (scrollbar styling, shimmer animation, user-message pill, dialog cursor fix).
- **Components are Lit `customElement`s**. File name and class name match the tag (`<chat-panel>` ↔ `ChatPanel.ts`).
- **Storage is IndexedDB-first**. `IndexedDBStorageBackend` is the only `StorageBackend` implementation.
- **Sandboxed iframes**: artifacts (HTML, SVG, Markdown) render inside `SandboxedIframe.ts` with `sandbox` + `csp` for isolation.
- **Peer deps**: `@mariozechner/mini-lit` and `lit` are peerDependencies; consumers provide them.

## ANTI-PATTERNS

- Editing `dist/app.css` directly — it is regenerated.
- Importing Node-only modules into components — bundled output is browser-only.
- Adding a `tsgo` step to this package — the build relies on `tsc`'s legacy `experimentalDecorators` emit for Lit.
- Hardcoding API keys / fetching from npm — keys come from the `ApiKeyPromptDialog` flow.

## NOTES

- The `example/` directory is a standalone npm project (not declared as a workspace in root `package.json`); it consumes this package via `file:` dependencies and serves as the dev playground.
- No fork modifications recorded so far — no `changes.md` exists.
- `pdfjs-dist`, `xlsx`, `docx-preview`, `jszip`, `highlight.js`, `lucide` are large deps; tree-shake at build time.
