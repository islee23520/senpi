# PR-008 Commands

This work is using code-yeongyu/lazycodex teammode.

## Failing First

```bash
cd /Users/yeongyu/local-workspaces/senpi/packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/suite/pi-codex-app-server-callbacks.test.ts
```

Result: failed before implementation because `server-request-bridge.ts` did not exist.
Raw local artifact:
`local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-008-callbacks/failing-first.txt`.

## Targeted And Adjacent Tests

```bash
cd /Users/yeongyu/local-workspaces/senpi/packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run test/suite/pi-codex-app-server-callbacks.test.ts
```

Result: 1 file / 4 tests passed.

```bash
cd /Users/yeongyu/local-workspaces/senpi/packages/coding-agent
npx tsx ../../node_modules/vitest/dist/cli.js --run \
  test/suite/pi-codex-app-server-callbacks.test.ts \
  test/suite/pi-codex-app-server-contract.test.ts \
  test/suite/pi-codex-app-server-routing.test.ts \
  test/suite/pi-codex-app-server-streaming.test.ts \
  test/suite/pi-codex-app-server-backpressure.test.ts
```

Result: 5 files / 21 tests passed.

## Check And QA

```bash
cd /Users/yeongyu/local-workspaces/senpi
npm run check
```

Result: passed after removing the untracked generated `.codegraph` symlink from
the checkout and fixing a TypeScript literal-union warning. The symlink pointed
to local CodeGraph daemon state and was not product code.

```bash
cd /Users/yeongyu/local-workspaces/senpi
NODE_PATH=/Users/yeongyu/local-workspaces/senpi/node_modules \
  node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check
NODE_PATH=/Users/yeongyu/local-workspaces/senpi/node_modules \
  node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test
NODE_PATH=/Users/yeongyu/local-workspaces/senpi/node_modules \
  node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test
node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --help
npx tsx local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-008-callbacks/tools/check-no-excuse-rules.ts \
  packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/server-request-bridge.ts \
  packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/server-request-fields.ts \
  packages/coding-agent/test/suite/pi-codex-app-server-callbacks.test.ts \
  packages/coding-agent/test/suite/pi-codex-app-server-contract.test.ts
git diff --check
```

Results:

- senpi QA common self-check: 9/9 passed.
- senpi QA CLI smoke: 5/5 passed.
- senpi QA mock loop: 5/5 passed.
- Adapter help rendered.
- No-excuse audit: no violations in 4 files.
- `git diff --check`: passed.

## Project Tracking

```bash
gh project list --owner code-yeongyu --format json --limit 20
```

Result: `BLOCKED:missing-gh-project-scope`; token is missing `read:project`.
