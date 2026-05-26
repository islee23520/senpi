#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cliPackagePath = require.resolve("@tailwindcss/cli/package.json");
const cliPath = join(dirname(cliPackagePath), "dist/index.mjs");

const result = spawnSync(process.execPath, ["--disable-warning=DEP0205", cliPath, ...process.argv.slice(2)], {
	stdio: "inherit",
});

process.exit(result.status ?? 1);
