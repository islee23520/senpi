/**
 * Vitest setup: quarantine SENPI_CODING_AGENT_DIR so the test suite never
 * writes session JSONLs into the user's real `~/.senpi/agent/sessions/`.
 *
 * Many tests call `SessionManager.create(tempDir)` without an explicit
 * sessionDir. That falls back to `getDefaultSessionDir(cwd)` → `getAgentDir()`,
 * which reads this env var. If unset, it resolves to the developer's real
 * $HOME and leaves faux-provider JSONLs there permanently, where downstream
 * tools (e.g. tokscale) then mis-count them as real usage.
 */

import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Guarded so an explicit `SENPI_CODING_AGENT_DIR=...` env (CI / opt-in) wins.
if (!process.env.SENPI_CODING_AGENT_DIR) {
	const quarantineDir = join(
		tmpdir(),
		`senpi-vitest-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		"agent",
	);
	mkdirSync(quarantineDir, { recursive: true });
	process.env.SENPI_CODING_AGENT_DIR = quarantineDir;
}
