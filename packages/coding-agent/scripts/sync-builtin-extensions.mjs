#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(scriptDir, "..");
const workspaceRoot = resolve(packageDir, "..", "..");
const defaultSourceRoot = resolve(workspaceRoot, "..", "pi-extensions");
const sourceRoot = resolve(process.env.SENPI_BUILTIN_EXTENSIONS_SOURCE ?? defaultSourceRoot);
const builtinRoot = join(packageDir, "src", "core", "extensions", "builtin");

const FILES = [
	{
		source: "pi-openai-api-parallel-tool-calls/src/index.ts",
		target: "openai-api-parallel-tool-calls/index.ts",
		transform: (content) =>
			content.replace(
				'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
				'import type { ExtensionAPI } from "../../types.js";',
			),
	},
	{
		source: "pi-bash-timeout/src/index.ts",
		target: "bash-timeout/index.ts",
		transform: (content) =>
			content.replace(
				'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
				'import type { ExtensionAPI } from "../../types.js";',
			),
	},
	{ source: "pi-bash-timeout/src/timeout.ts", target: "bash-timeout/timeout.ts" },
	{
		source: "pi-webfetch/src/index.ts",
		target: "webfetch/index.ts",
		transform: (content) =>
			content
				.replace(
					'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
					'import type { ExtensionAPI } from "../../types.js";',
				)
				.replace(
					'import { renderWebfetchCall, renderWebfetchResult } from "./webfetch/renderers.js";',
					'import { renderWebfetchCall, renderWebfetchResult } from "./renderers.js";',
				)
				.replace(
					'import { type WebfetchDetails, webfetch } from "./webfetch/tool.js";',
					'import { type WebfetchDetails, webfetch } from "./tool.js";',
				),
	},
	{ source: "pi-webfetch/src/webfetch/content.ts", target: "webfetch/content.ts" },
	{
		source: "pi-webfetch/src/webfetch/fetcher.ts",
		target: "webfetch/fetcher.ts",
		transform: (content) => content.replace(": HeadersInit", ": Record<string, string>"),
	},
	{
		source: "pi-webfetch/src/webfetch/tool.ts",
		target: "webfetch/tool.ts",
		transform: (content) =>
			content
				.replace(
					'import { defineTool } from "@mariozechner/pi-coding-agent";',
					'import { defineTool } from "../../types.js";',
				)
				.replace(
					'import { StringEnum } from "@mariozechner/pi-ai";\nimport { defineTool } from "../../types.js";\nimport { Type } from "typebox";',
					'import { StringEnum } from "@mariozechner/pi-ai";\nimport { Type } from "typebox";\nimport { defineTool } from "../../types.js";',
				),
	},
	{
		source: "pi-webfetch/src/webfetch/renderers.ts",
		target: "webfetch/renderers.ts",
		transform: (content) =>
			content
				.replace(
					'import type { Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";',
					'import type { ToolRenderResultOptions } from "../../types.js";\nimport type { theme as ThemeInstance } from "../../../../modes/interactive/theme/theme.js";',
				)
				.replace(
					'import type { ToolRenderResultOptions } from "../../types.js";\nimport type { theme as ThemeInstance } from "../../../../modes/interactive/theme/theme.js";\nimport { Text, truncateToWidth } from "@mariozechner/pi-tui";',
					'import { Text, truncateToWidth } from "@mariozechner/pi-tui";\nimport type { theme as ThemeInstance } from "../../../../modes/interactive/theme/theme.js";\nimport type { ToolRenderResultOptions } from "../../types.js";',
				)
				.replaceAll(": Theme", ": typeof ThemeInstance"),
	},
	{
		source: "pi-apply-patch/src/index.ts",
		target: "gpt-apply-patch/index.ts",
		transform: (content) =>
			content
				.replace(
					'import type { AgentToolResult } from "@mariozechner/pi-agent-core";',
					'import type { AgentToolResult } from "../../types.js";',
				)
				.replace(
					'import { defineTool, type ExtensionAPI, type ToolDefinition } from "@mariozechner/pi-coding-agent";',
					'import { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";',
				)
				.replace(
					'import type { AgentToolResult } from "../../types.js";\nimport type { Model } from "@mariozechner/pi-ai";\nimport { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";\nimport { Type } from "typebox";',
					'import type { Model } from "@mariozechner/pi-ai";\nimport { Type } from "typebox";\nimport type { AgentToolResult } from "../../types.js";\nimport { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";',
				),
	},
];

const PACKAGES = [
	{ id: "openai-api-parallel-tool-calls", packageDir: "pi-openai-api-parallel-tool-calls" },
	{ id: "bash-timeout", packageDir: "pi-bash-timeout" },
	{ id: "webfetch", packageDir: "pi-webfetch" },
	{ id: "gpt-apply-patch", packageDir: "pi-apply-patch" },
];

function readPackageMetadata(packageName) {
	const packageJsonPath = join(sourceRoot, packageName, "package.json");
	const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
	return {
		packageName: packageJson.name,
		version: packageJson.version,
		source: `../pi-extensions/${packageName}`,
	};
}

if (!existsSync(sourceRoot)) {
	console.log(`[sync-builtin-extensions] source not found, keeping vendored snapshot: ${sourceRoot}`);
	process.exit(0);
}

for (const entry of FILES) {
	const sourcePath = join(sourceRoot, entry.source);
	const targetPath = join(builtinRoot, entry.target);
	if (!existsSync(sourcePath)) {
		throw new Error(`missing source file: ${sourcePath}`);
	}
	mkdirSync(dirname(targetPath), { recursive: true });
	const content = readFileSync(sourcePath, "utf-8");
	writeFileSync(targetPath, entry.transform ? entry.transform(content) : content, "utf-8");
}

const manifest = { extensions: {} };
for (const packageEntry of PACKAGES) {
	manifest.extensions[packageEntry.id] = readPackageMetadata(packageEntry.packageDir);
}
writeFileSync(join(builtinRoot, "external-versions.json"), `${JSON.stringify(manifest, null, "\t")}\n`, "utf-8");

console.log(`[sync-builtin-extensions] synced from ${sourceRoot}`);
