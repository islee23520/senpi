# PR-007 Commands

This work is using code-yeongyu/lazycodex teammode.

All commands were run from `/Users/yeongyu/local-workspaces/senpi` unless noted.

```bash
git fetch origin main --prune
git switch -c code-yeongyu/pi-codex-app-server-backpressure-lag origin/main
```

```bash
cd packages/coding-agent &&
  npx tsx ../../node_modules/vitest/dist/cli.js --run \
    test/suite/pi-codex-app-server-backpressure.test.ts
```

```bash
cd packages/coding-agent &&
  npx tsx ../../node_modules/vitest/dist/cli.js --run \
    test/suite/pi-codex-app-server-backpressure.test.ts \
    test/suite/pi-codex-app-server-streaming.test.ts \
    test/suite/pi-codex-app-server-contract.test.ts \
    test/suite/pi-codex-app-server-routing.test.ts \
    test/suite/pi-codex-app-server-capability.test.ts
```

```bash
npm run check
node .agents/skills/senpi-qa/scripts/lib/common.mjs --self-check
node .agents/skills/senpi-qa/scripts/cli-smoke.mjs --self-test
node .agents/skills/senpi-qa/scripts/mock-loop.mjs --self-test
node packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/qa/drive-adapter.mjs --help
gh project list --owner code-yeongyu --format json --limit 20
```

```bash
NODE_PATH=/Users/yeongyu/local-workspaces/senpi/node_modules \
  bun run /Users/yeongyu/.codex/plugins/cache/sisyphuslabs/omo/4.13.0/skills/programming/scripts/typescript/check-no-excuse-rules.ts \
    packages/coding-agent/src/core/extensions/builtin/pi-codex-app-server/stream-backpressure.ts \
    packages/coding-agent/test/suite/pi-codex-app-server-backpressure.test.ts
```

Review follow-up for lag marker sequence monotonicity reused the same targeted,
adjacent, check, and senpi QA commands. Refreshed local artifact filenames use
the `followup-lag-sequence-*` prefix under
`local-ignore/qa-evidence/20260624-pi-codex-app-server/pr-007-backpressure/`.
