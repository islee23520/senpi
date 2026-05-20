import { readFileSync, writeFileSync } from "node:fs";

export const WORKSPACE_PACKAGES = [
	"packages/ai/package.json",
	"packages/agent/package.json",
	"packages/coding-agent/package.json",
	"packages/tui/package.json",
	"packages/web-ui/package.json",
];

const PUBLIC_PACKAGE_DEPENDENCY_PINS = [
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-ai",
	"@earendil-works/pi-tui",
];

function writeWorkspaceVersion(file, version, dryRun, log, dryRunLog) {
	const raw = readFileSync(file, "utf-8");
	const pkg = JSON.parse(raw);
	const previous = pkg.version;
	if (previous === version) {
		log(`  ${file}: already ${version}`);
		return;
	}
	if (dryRun) {
		dryRunLog(`write ${file} (version: ${previous} -> ${version})`);
		return;
	}
	pkg.version = version;
	writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	log(`  ${file}: ${previous} -> ${version}`);
}

export function applyWorkspaceVersions(version, dryRun, log, dryRunLog) {
	log(`applying version ${version} to ${WORKSPACE_PACKAGES.length} workspace package.json files`);
	for (const file of WORKSPACE_PACKAGES) {
		writeWorkspaceVersion(file, version, dryRun, log, dryRunLog);
	}
}

export function runSyncVersions(dryRun, runCommand, log, dryRunLog) {
	if (dryRun) {
		dryRunLog("node scripts/sync-versions.js");
		return;
	}
	log("running scripts/sync-versions.js");
	runCommand("node", ["scripts/sync-versions.js"]);
}

function getPublishedVersion(packageName, captureCommand) {
	return captureCommand("npm", ["view", packageName, "version"]).trim();
}

export function pinPublicPackageDependencies(dryRun, captureCommand, log, dryRunLog) {
	const file = "packages/coding-agent/package.json";
	const raw = readFileSync(file, "utf-8");
	const pkg = JSON.parse(raw);
	const updates = [];

	for (const depName of PUBLIC_PACKAGE_DEPENDENCY_PINS) {
		const publishedVersion = getPublishedVersion(depName, captureCommand);
		const newRange = `^${publishedVersion}`;
		const currentRange = pkg.dependencies?.[depName];
		if (currentRange !== newRange) {
			updates.push({ depName, currentRange, newRange });
			if (!dryRun) {
				pkg.dependencies[depName] = newRange;
			}
		}
	}

	if (updates.length === 0) {
		log("public package dependencies already point at published npm versions");
		return updates;
	}

	log("pinning public package dependencies to published npm versions");
	for (const update of updates) {
		const previous = update.currentRange ?? "<missing>";
		const message = `  ${update.depName}: ${previous} -> ${update.newRange}`;
		if (dryRun) {
			dryRunLog(message);
		} else {
			log(message);
		}
	}

	if (!dryRun) {
		writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
	return updates;
}

export function restorePublicPackageDependencies(updates, dryRun, log, dryRunLog) {
	if (updates.length === 0) return;

	const file = "packages/coding-agent/package.json";
	const raw = readFileSync(file, "utf-8");
	const pkg = JSON.parse(raw);
	log("restoring source workspace dependency ranges");

	for (const update of updates) {
		const restoreRange = update.currentRange;
		const message = `  ${update.depName}: ${update.newRange} -> ${restoreRange ?? "<missing>"}`;
		if (dryRun) {
			dryRunLog(message);
			continue;
		}
		log(message);
		if (restoreRange === undefined) {
			delete pkg.dependencies[update.depName];
		} else {
			pkg.dependencies[update.depName] = restoreRange;
		}
	}

	if (!dryRun) {
		writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	}
}
