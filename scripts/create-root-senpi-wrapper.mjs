import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultRoot = dirname(__dirname);

export function shouldWriteGlobalShim(root = defaultRoot, environment = process.env) {
	if (environment.CI) {
		return false;
	}
	return existsSync(join(root, ".git"));
}

export function createRootSenpiWrapper({
	root = defaultRoot,
	globalPrefix,
	writeGlobalShim = shouldWriteGlobalShim(root),
} = {}) {
	const distDir = join(root, "dist");
	const wrapperPath = join(distDir, "senpi");

	mkdirSync(distDir, { recursive: true });
	writeFileSync(
		wrapperPath,
		`#!/usr/bin/env node
import "../packages/coding-agent/dist/senpi";
`,
		"utf8",
	);
	chmodSync(wrapperPath, 0o755);

	if (!writeGlobalShim) {
		return { wrapperPath, globalShimPath: undefined, globalShimWritten: false };
	}

	const resolvedGlobalPrefix = globalPrefix ?? execFileSync("npm", ["prefix", "-g"], { encoding: "utf8" }).trim();
	const globalBinDir = join(resolvedGlobalPrefix, "bin");
	const globalShimPath = join(globalBinDir, "senpi");

	mkdirSync(globalBinDir, { recursive: true });
	if (existsSync(globalShimPath)) {
		rmSync(globalShimPath);
	}
	writeFileSync(
		globalShimPath,
		`#!/bin/sh
exec "${wrapperPath}" "$@"
`,
		"utf8",
	);
	chmodSync(globalShimPath, 0o755);

	return { wrapperPath, globalShimPath, globalShimWritten: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	createRootSenpiWrapper();
}
