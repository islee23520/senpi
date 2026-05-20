/**
 * Regression test: senpi --neo (Rust + ratatui) MUST ship the same
 * default keybindings as the legacy senpi interactive TUI. Users have
 * to be able to flip the `--neo` flag without losing a single chord of
 * muscle memory.
 *
 * Source of truth on the legacy side: `KEYBINDINGS` from
 * `packages/coding-agent/src/core/keybindings.ts` (which extends
 * `TUI_KEYBINDINGS` from `packages/tui`).
 *
 * Source of truth on the neo side: `packages/neo-tui/assets/keymaps/
 * default.json`. The Rust crate ships the same file via `include_str!`
 * and has a matching exhaustive test
 * (`packages/neo-tui/tests/keymap.rs::
 * bundled_default_keymap_matches_legacy_senpi_registry_one_to_one`).
 *
 * Two-sided enforcement means drift on EITHER side fails CI loudly.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type { KeyId } from "../../../src/core/keybindings.ts";
import { KEYBINDINGS } from "../../../src/core/keybindings.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NEO_KEYMAP_PATH = resolve(__dirname, "..", "..", "..", "..", "neo-tui", "assets", "keymaps", "default.json");

interface NeoKeymap {
	bindings: Record<string, string[]>;
}

function loadNeoKeymap(): NeoKeymap {
	const raw = readFileSync(NEO_KEYMAP_PATH, "utf8");
	const parsed = JSON.parse(raw) as { bindings?: Record<string, string[]> };
	expect(parsed.bindings, "default.json must have a bindings object").toBeDefined();
	return { bindings: parsed.bindings ?? {} };
}

function normalize(keys: KeyId | KeyId[] | undefined): string[] {
	if (keys === undefined) return [];
	return Array.isArray(keys) ? [...keys] : [keys];
}

describe("senpi --neo keymap parity with the legacy registry", () => {
	test("every legacy binding ID is present in the bundled neo keymap with identical default keys", () => {
		const neo = loadNeoKeymap();
		const drift: string[] = [];
		const missing: string[] = [];

		for (const [id, definition] of Object.entries(KEYBINDINGS) as [string, { defaultKeys: KeyId | KeyId[] }][]) {
			const expected = normalize(definition.defaultKeys);
			const actual = neo.bindings[id];
			if (actual === undefined) {
				missing.push(id);
				continue;
			}
			if (JSON.stringify(actual) !== JSON.stringify(expected)) {
				drift.push(`  - "${id}" legacy=${JSON.stringify(expected)} neo=${JSON.stringify(actual)}`);
			}
		}

		expect(
			missing.length === 0 && drift.length === 0,
			`neo-tui default keymap drifted from packages/coding-agent::KEYBINDINGS.\n` +
				`missing IDs:\n  ${missing.join(", ") || "<none>"}\n` +
				`drifted IDs:\n${drift.join("\n") || "  <none>"}`,
		).toBe(true);
	});

	test("non-legacy bindings in the neo keymap live under the `neo.*` namespace", () => {
		const neo = loadNeoKeymap();
		const legacy = new Set(Object.keys(KEYBINDINGS));
		const offenders: string[] = [];
		for (const id of Object.keys(neo.bindings)) {
			if (legacy.has(id)) continue;
			if (!id.startsWith("neo.")) {
				offenders.push(id);
			}
		}
		expect(offenders).toEqual([]);
	});

	test("the legacy registry has not lost any binding (sanity check on this side of the fence)", () => {
		const expectedAtLeast = [
			"tui.editor.cursorUp",
			"tui.editor.deleteWordBackward",
			"tui.input.submit",
			"tui.select.cancel",
			"app.interrupt",
			"app.model.select",
			"app.thinking.cycle",
			"app.editor.external",
			"app.message.followUp",
		];
		for (const id of expectedAtLeast) {
			expect(id in KEYBINDINGS, `legacy KEYBINDINGS missing well-known binding "${id}"`).toBe(true);
		}
	});
});
