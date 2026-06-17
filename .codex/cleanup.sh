#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rm -rf "$ROOT/node_modules" "$ROOT"/packages/*/dist "$ROOT/.agents/skills/senpi-qa/node_modules"
