#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createRootSenpiWrapper, shouldWriteGlobalShim } from "./create-root-senpi-wrapper.mjs";

describe("create-root-senpi-wrapper", () => {
	it("does not write a global shim when the root is a gitless snapshot", () => {
		// Given
		const root = mkdtempSync(join(tmpdir(), "senpi-wrapper-snapshot-"));
		const globalPrefix = mkdtempSync(join(tmpdir(), "senpi-wrapper-global-"));

		// When
		const result = createRootSenpiWrapper({ root, globalPrefix });

		// Then
		assert.equal(shouldWriteGlobalShim(root), false);
		assert.equal(result.globalShimWritten, false);
		assert.equal(readFileSync(result.wrapperPath, "utf8").includes("packages/coding-agent/dist/cli.js"), true);
	});
});
