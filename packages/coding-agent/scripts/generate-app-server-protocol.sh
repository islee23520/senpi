#!/usr/bin/env bash
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
	echo "codex not found on PATH; install codex-cli before regenerating app-server protocol types." >&2
	exit 1
fi

protocol_dir="src/modes/app-server/protocol"
generated_dir="${protocol_dir}/generated"

command codex app-server generate-ts --experimental --out "${generated_dir}"
command codex --version | sed -E 's/.* ([0-9]+[.][0-9]+[.][0-9]+).*/\1/' > "${protocol_dir}/PROTOCOL_VERSION.txt"
