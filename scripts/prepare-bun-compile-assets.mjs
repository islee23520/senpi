#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const cssTreeRoots = [
	join(repoRoot, "node_modules", "css-tree"),
	join(repoRoot, "packages", "coding-agent", "node_modules", "css-tree"),
];

let preparedCount = 0;

for (const cssTreeRoot of cssTreeRoots) {
	const patchJsonPath = join(cssTreeRoot, "data", "patch.json");
	const packageJsonPath = join(cssTreeRoot, "package.json");
	const cjsPatchPath = join(cssTreeRoot, "cjs", "data-patch.cjs");
	const cjsVersionPath = join(cssTreeRoot, "cjs", "version.cjs");
	const esmPatchPath = join(cssTreeRoot, "lib", "data-patch.js");
	const esmVersionPath = join(cssTreeRoot, "lib", "version.js");

	if (!existsSync(patchJsonPath)) {
		continue;
	}

	const patchData = JSON.parse(readFileSync(patchJsonPath, "utf8"));
	const serializedPatch = `${JSON.stringify(patchData, null, "\t")}\n`;

	if (existsSync(cjsPatchPath)) {
		writeFileSync(cjsPatchPath, `'use strict';\n\nmodule.exports = ${serializedPatch}`);
	}

	if (existsSync(esmPatchPath)) {
		writeFileSync(esmPatchPath, `const patch = ${serializedPatch}\nexport default patch;\n`);
	}

	if (existsSync(packageJsonPath)) {
		const { version } = JSON.parse(readFileSync(packageJsonPath, "utf8"));
		if (existsSync(cjsVersionPath)) {
			writeFileSync(cjsVersionPath, `'use strict';\n\nmodule.exports.version = ${JSON.stringify(version)};\n`);
		}
		if (existsSync(esmVersionPath)) {
			writeFileSync(esmVersionPath, `export const version = ${JSON.stringify(version)};\n`);
		}
	}

	preparedCount += 1;
}

if (preparedCount === 0) {
	console.log("[prepare-bun-compile-assets] css-tree patch data not installed; skipping");
	process.exit(0);
}

console.log(`[prepare-bun-compile-assets] prepared css-tree patch data for Bun compile (${preparedCount})`);
