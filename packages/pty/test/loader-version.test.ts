import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getNativePtySentinelExport, NATIVE_PTY_PACKAGE_VERSION } from "../src/loader.ts";

// The compiled Bun single-file binary made `import.meta.url` resolve to `/$bunfs/root/pi`,
// so the eager `require("../package.json")` threw at module load and crashed every CLI
// command. These tests pin the resolved-version contract that fix depends on: they cannot
// even be collected unless `../src/loader.ts` loaded without throwing, and they assert the
// sentinel export is derived from that resolved version so a regression surfaces here.

const SENTINEL_SHAPE = /^__senpiPtyV\d+_\d+_\d+$/;
const SEMVER_CORE = /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

// Independent node/tsx resolution path: read the package's own package.json the way a
// consumer running under node would, so we cross-check against the module-load result
// rather than trusting the value the module produced.
function readOwnPackageVersion(): string {
	const raw: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8"));
	if (!isRecord(raw) || typeof raw.version !== "string") {
		throw new Error("test fixture: package.json is missing a string version");
	}
	return raw.version;
}

// Recompute the sentinel from major/minor/patch by hand so a bug in either the resolved
// version or the derivation reddens the cross-check, not just a self-consistent echo.
function expectedSentinel(version: string): string {
	const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
	if (match === null) {
		throw new Error(`test fixture: version is not semver-core: ${version}`);
	}
	return `__senpiPtyV${match[1]}_${match[2]}_${match[3]}`;
}

describe("NATIVE_PTY_PACKAGE_VERSION", () => {
	it("resolves to the package.json version at module load (proving load did not throw)", () => {
		expect(typeof NATIVE_PTY_PACKAGE_VERSION).toBe("string");
		expect(NATIVE_PTY_PACKAGE_VERSION.length).toBeGreaterThan(0);
		expect(NATIVE_PTY_PACKAGE_VERSION).toMatch(SEMVER_CORE);
		expect(NATIVE_PTY_PACKAGE_VERSION).toBe(readOwnPackageVersion());
	});
});

describe("getNativePtySentinelExport", () => {
	it("derives the sentinel from the resolved package version", () => {
		const sentinel = getNativePtySentinelExport(NATIVE_PTY_PACKAGE_VERSION);
		expect(sentinel).toMatch(SENTINEL_SHAPE);
		expect(sentinel).toBe(expectedSentinel(NATIVE_PTY_PACKAGE_VERSION));
	});

	it.each([
		["2026.7.5-2", "__senpiPtyV2026_7_5"],
		["1.0.0", "__senpiPtyV1_0_0"],
		["10.20.30+build.7", "__senpiPtyV10_20_30"],
	])("maps semver %s to sentinel %s (dropping any suffix)", (version, expected) => {
		expect(getNativePtySentinelExport(version)).toBe(expected);
	});

	it.each([["not-semver"], ["2026.7"], ["v1.2.3"], [""]])("throws for the non-semver version %s", (version) => {
		expect(() => getNativePtySentinelExport(version)).toThrow(/not semver-compatible/);
	});
});
