#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const bundledWorkspaces = [
	{ source: "packages/agent", packageName: "@earendil-works/pi-agent-core", targetParts: ["@earendil-works", "pi-agent-core"], sourceOnly: false },
	{ source: "packages/ai", packageName: "@earendil-works/pi-ai", targetParts: ["@earendil-works", "pi-ai"], sourceOnly: false },
	{ source: "packages/tui", packageName: "@earendil-works/pi-tui", targetParts: ["@earendil-works", "pi-tui"], sourceOnly: false },
	{
		source: "packages/senpi-codemode",
		packageName: "@code-yeongyu/senpi-codemode",
		targetParts: ["@code-yeongyu", "senpi-codemode"],
		sourceOnly: true,
	},
];
const internalPackageNames = new Set(bundledWorkspaces.map((workspace) => workspace.packageName));
const bundledWorkspacePackageNames = bundledWorkspaces.map((workspace) => workspace.packageName);

function shouldCopyWorkspaceFile(sourceRoot, sourcePath, sourceOnly = false) {
	const path = relative(sourceRoot, sourcePath);
	return (
		path === "" ||
		path === "package.json" ||
		path === "README.md" ||
		path === "CHANGELOG.md" ||
		path === "LICENSE" ||
		path === "dist" ||
		path.startsWith(`dist/`) ||
		(sourceOnly && (path === "src" || path.startsWith("src/")))
	);
}

export function directNodeModulesPackageName(lockPath) {
	if (!lockPath.startsWith("node_modules/")) {
		return undefined;
	}

	const parts = lockPath.slice("node_modules/".length).split("/");
	if (parts[0]?.startsWith("@")) {
		return parts.length === 2 ? `${parts[0]}/${parts[1]}` : undefined;
	}
	return parts.length === 1 ? parts[0] : undefined;
}

export function copyPublishDependencies(repoRoot) {
	const shrinkwrapPath = join(repoRoot, "packages/coding-agent/npm-shrinkwrap.json");
	const shrinkwrap = JSON.parse(readFileSync(shrinkwrapPath, "utf8"));
	const rootNodeModules = join(repoRoot, "node_modules");
	const codingAgentNodeModules = join(repoRoot, "packages/coding-agent/node_modules");

	for (const [lockPath, entry] of Object.entries(shrinkwrap.packages ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
		const packageName = directNodeModulesPackageName(lockPath);
		if (!packageName || internalPackageNames.has(packageName)) {
			continue;
		}

		const sourcePath = join(rootNodeModules, packageName);
		if (!existsSync(sourcePath)) {
			if (entry && typeof entry === "object" && entry.optional === true) {
				continue;
			}
			throw new Error(`Missing ${sourcePath}. Run npm install before publishing.`);
		}

		const targetPath = join(codingAgentNodeModules, packageName);
		rmSync(targetPath, { recursive: true, force: true });
		mkdirSync(dirname(targetPath), { recursive: true });
		cpSync(sourcePath, targetPath, { recursive: true });
	}
}

export function assertSenpiPackedWorkspaceFiles(packed) {
	const filePaths = new Set((packed.files ?? []).map((file) => file.path));
	const missing = [];

	for (const packageName of bundledWorkspacePackageNames) {
		const packageRoot = `package/node_modules/${packageName}`;
		const dryRunPackageRoot = `node_modules/${packageName}`;
		const isCodemode = packageName === "@code-yeongyu/senpi-codemode";
		const packageRequiredPaths = isCodemode
			? [
					["src/index.ts", "src/index.ts"],
					["src/kernels/py/prelude.py", "src/kernels/py/prelude.py"],
				]
			: [["dist/index.js", "dist/index.js"]];
		for (const [path, dryRunPath] of [
			[`${packageRoot}/package.json`, `${dryRunPackageRoot}/package.json`],
			...packageRequiredPaths.map(([path, dryRunPath]) => [
				`${packageRoot}/${path}`,
				`${dryRunPackageRoot}/${dryRunPath}`,
			]),
		]) {
			if (!filePaths.has(path) && !filePaths.has(dryRunPath)) {
				missing.push(`${path} or ${dryRunPath}`);
			}
		}
	}

	if (missing.length > 0) {
		throw new Error(`senpi package tarball is missing bundled workspace files: ${missing.join(", ")}`);
	}
}

export function prepareSenpiBundledWorkspaces(repoRoot = root) {
	copyPublishDependencies(repoRoot);
	const codingAgentNodeModules = join(repoRoot, "packages/coding-agent/node_modules");

	for (const workspace of bundledWorkspaces) {
		const sourceRoot = join(repoRoot, workspace.source);
		const distPath = join(sourceRoot, "dist");
		if (!workspace.sourceOnly && !existsSync(distPath)) {
			throw new Error(`Missing ${distPath}. Run npm run build before preparing bundled workspaces.`);
		}

		const targetRoot = join(codingAgentNodeModules, ...workspace.targetParts);
		rmSync(targetRoot, { recursive: true, force: true });
		mkdirSync(dirname(targetRoot), { recursive: true });
		cpSync(sourceRoot, targetRoot, {
			recursive: true,
			filter: (sourcePath) => shouldCopyWorkspaceFile(sourceRoot, sourcePath, workspace.sourceOnly),
		});
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	prepareSenpiBundledWorkspaces();
}
