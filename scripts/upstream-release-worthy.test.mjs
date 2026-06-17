import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	decideReleaseWorthiness,
	extractUnreleasedSection,
	hasUnreleasedEntries,
} from "./upstream-release-worthy.mjs";

describe("upstream release worthiness", () => {
	it("detects package changelog entries under Unreleased", () => {
		const text = "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Fixed upstream sync.\n\n## [2026.6.17]\n\n";
		assert.equal(hasUnreleasedEntries(text), true);
		assert.equal(extractUnreleasedSection(text).includes("Fixed upstream sync"), true);
	});

	it("skips empty Unreleased sections", () => {
		const files = [{ path: "packages/coding-agent/CHANGELOG.md", content: "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n" }];
		assert.deepEqual(decideReleaseWorthiness(files), {
			releaseWorthy: false,
			reason: "no-unreleased-package-entries",
		});
	});

	it("releases when any package changelog has an Unreleased entry", () => {
		const files = [
			{ path: "packages/ai/CHANGELOG.md", content: "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n" },
			{ path: "packages/tui/CHANGELOG.md", content: "# Changelog\n\n## [Unreleased]\n\n### Changed\n\n- Updated rendering.\n" },
		];
		assert.equal(decideReleaseWorthiness(files).releaseWorthy, true);
	});

	it("allows explicit forced release", () => {
		const files = [{ path: "packages/coding-agent/CHANGELOG.md", content: "# Changelog\n\n## [Unreleased]\n\n" }];
		assert.deepEqual(decideReleaseWorthiness(files, { forceRelease: true }), {
			releaseWorthy: true,
			reason: "forced",
		});
	});
});
