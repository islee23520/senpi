import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { archiveUpstreamAgentReport } from "./archive-upstream-agent-report.mjs";

let tempDir;

function run(command, args, cwd, options = {}) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (!options.allowFailure && result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
	}
	return result;
}

function createRepo() {
	tempDir = mkdtempSync(join(tmpdir(), "senpi-upstream-report-"));
	run("git", ["init", "-q"], tempDir);
	run("git", ["config", "user.name", "test"], tempDir);
	run("git", ["config", "user.email", "test@example.com"], tempDir);
	writeFileSync(join(tempDir, ".gitignore"), "local-ignore/\n");
	run("git", ["add", ".gitignore"], tempDir);
	run("git", ["commit", "-q", "-m", "test: base"], tempDir);
	return tempDir;
}

function writeReport(repo, text = "report\n") {
	const report = join(repo, ".github/agent/last-merge-report.md");
	mkdirSync(join(repo, ".github/agent"), { recursive: true });
	writeFileSync(report, text);
	return report;
}

function status(repo) {
	return run("git", ["status", "--porcelain"], repo).stdout;
}

afterEach(() => {
	if (tempDir) {
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("archiveUpstreamAgentReport", () => {
	it("copies and removes an untracked report without dirtying the branch", () => {
		// Given
		const repo = createRepo();
		writeReport(repo, "untracked report\n");

		// When
		const result = archiveUpstreamAgentReport({ cwd: repo, evidenceDir: "local-ignore/qa-evidence/upstream-agent" });

		// Then
		assert.equal(result.archived, true);
		assert.equal(result.committedRemoval, false);
		assert.equal(readFileSync(join(repo, "local-ignore/qa-evidence/upstream-agent/last-merge-report.md"), "utf8"), "untracked report\n");
		assert.equal(existsSync(join(repo, ".github/agent/last-merge-report.md")), false);
		assert.equal(status(repo), "");
	});

	it("removes a committed report from the final branch tree with a cleanup commit", () => {
		// Given
		const repo = createRepo();
		writeReport(repo, "committed report\n");
		run("git", ["add", ".github/agent/last-merge-report.md"], repo);
		run("git", ["commit", "-q", "-m", "test: committed report"], repo);

		// When
		const result = archiveUpstreamAgentReport({ cwd: repo, evidenceDir: "local-ignore/qa-evidence/upstream-agent" });

		// Then
		assert.equal(result.archived, true);
		assert.equal(result.committedRemoval, true);
		assert.equal(readFileSync(join(repo, "local-ignore/qa-evidence/upstream-agent/last-merge-report.md"), "utf8"), "committed report\n");
		assert.equal(status(repo), "");
		assert.equal(run("git", ["log", "-1", "--pretty=%s"], repo).stdout.trim(), "chore: remove upstream agent report");
		assert.notEqual(
			run("git", ["cat-file", "-e", "HEAD:.github/agent/last-merge-report.md"], repo, { allowFailure: true }).status,
			0,
		);
	});
});
