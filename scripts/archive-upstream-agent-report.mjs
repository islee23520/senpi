#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_REPORT_PATH = ".github/agent/last-merge-report.md";
const DEFAULT_EVIDENCE_DIR = "local-ignore/qa-evidence/upstream-agent";

function git(args, cwd, options = {}) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: options.quiet ? "pipe" : "inherit",
	});
	if (!options.allowFailure && result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed with status ${result.status ?? "unknown"}`);
	}
	return result;
}

function isTrackedInHead(cwd, reportPath) {
	return git(["cat-file", "-e", `HEAD:${reportPath}`], cwd, { quiet: true, allowFailure: true }).status === 0;
}

function isTrackedInIndex(cwd, reportPath) {
	return git(["ls-files", "--error-unmatch", "--", reportPath], cwd, { quiet: true, allowFailure: true }).status === 0;
}

export function archiveUpstreamAgentReport(options = {}) {
	const cwd = options.cwd ?? process.cwd();
	const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
	const evidenceDir = options.evidenceDir ?? process.env.EVIDENCE_DIR ?? DEFAULT_EVIDENCE_DIR;
	const source = join(cwd, reportPath);
	const destination = join(cwd, evidenceDir, "last-merge-report.md");

	if (!existsSync(source)) {
		return { archived: false, committedRemoval: false, destination };
	}

	mkdirSync(dirname(destination), { recursive: true });
	copyFileSync(source, destination);

	const trackedInHead = isTrackedInHead(cwd, reportPath);
	const trackedInIndex = isTrackedInIndex(cwd, reportPath);

	if (trackedInHead) {
		git(["rm", "--quiet", "--", reportPath], cwd);
		git(["commit", "--quiet", "--only", "-m", "chore: remove upstream agent report", "--", reportPath], cwd);
		return { archived: true, committedRemoval: true, destination };
	}

	if (trackedInIndex) {
		git(["rm", "--quiet", "--force", "--", reportPath], cwd);
	} else {
		unlinkSync(source);
	}

	return { archived: true, committedRemoval: false, destination };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const result = archiveUpstreamAgentReport();
	if (result.archived) {
		process.stdout.write(
			`Archived upstream agent report to ${result.destination}${result.committedRemoval ? " and committed report removal" : ""}.\n`,
		);
	} else {
		process.stdout.write("No upstream agent report found.\n");
	}
}
