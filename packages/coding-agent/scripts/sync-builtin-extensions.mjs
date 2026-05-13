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
		source: "pi-bash-timeout/src/index.ts",
		target: "bash-timeout/index.ts",
		transform: (content) =>
			content.replace(
				'import type { ExtensionAPI } from "@code-yeongyu/senpi";',
				'import type { ExtensionAPI } from "../../types.js";',
			),
	},
	{ source: "pi-bash-timeout/src/timeout.ts", target: "bash-timeout/timeout.ts" },
	{
		source: "pi-apply-patch/src/index.ts",
		target: "gpt-apply-patch/index.ts",
		transform: (content) =>
			content
				.replace(
					'import type { AgentToolResult } from "@earendil-works/pi-agent-core";',
					'import type { AgentToolResult } from "../../types.js";',
				)
				.replace(
					'import { defineTool, type ExtensionAPI, type ToolDefinition } from "@code-yeongyu/senpi";',
					'import { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";',
				)
				.replace(
					'import type { AgentToolResult } from "../../types.js";\nimport type { Model } from "@earendil-works/pi-ai";\nimport { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";\nimport { Type } from "typebox";',
					'import type { Model } from "@earendil-works/pi-ai";\nimport { Type } from "typebox";\nimport type { AgentToolResult } from "../../types.js";\nimport { defineTool, type ExtensionAPI, type ToolDefinition } from "../../types.js";',
				),
	},
	{
		source: "pi-todotools/src/index.ts",
		target: "todotools/index.ts",
		transform: (content) =>
			content.replace(
				'import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";',
				'import type { ExtensionAPI, ExtensionContext } from "../../types.js";',
			),
	},
	{ source: "pi-todotools/src/prompt.ts", target: "todotools/prompt.ts" },
	{ source: "pi-todotools/src/settings.ts", target: "todotools/settings.ts" },
	{ source: "pi-todotools/src/state.ts", target: "todotools/state.ts" },
	{
		source: "pi-todotools/src/system-messages.ts",
		target: "todotools/system-messages.ts",
		transform: (content) =>
			content
				.replace(
					'import type { ImageContent, TextContent } from "@mariozechner/pi-ai";',
					'import type { ImageContent, TextContent } from "@earendil-works/pi-ai";',
				)
				.replace(
					'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
					'import type { ExtensionAPI } from "../../types.js";',
				),
	},
	{ source: "pi-todotools/src/continuation/config.ts", target: "todotools/continuation/config.ts" },
	{ source: "pi-todotools/src/continuation/index.ts", target: "todotools/continuation/index.ts" },
	{ source: "pi-todotools/src/continuation/prompt.ts", target: "todotools/continuation/prompt.ts" },
	{
		source: "pi-todotools/src/continuation/runtime.ts",
		target: "todotools/continuation/runtime.ts",
		transform: (content) =>
			content
				.replace(
					'import type { AssistantMessage } from "@mariozechner/pi-ai";',
					'import type { AssistantMessage } from "@earendil-works/pi-ai";',
				)
				.replace(
					'import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@mariozechner/pi-coding-agent";',
					'import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "../../../types.js";',
				),
	},
	{
		source: "pi-todotools/src/tools/todoread.ts",
		target: "todotools/tools/todoread.ts",
		transform: (content) =>
			content
				.replace(
					'import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";',
					'import type { ExtensionAPI } from "../../../types.js";',
				)
				.replace('import { Text } from "@mariozechner/pi-tui";', 'import { Text } from "@earendil-works/pi-tui";'),
	},
	{
		source: "pi-todotools/src/tools/todowrite.ts",
		target: "todotools/tools/todowrite.ts",
		transform: (content) =>
			content
				.replace(
					'import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";',
					'import type { ExtensionAPI, ExtensionContext } from "../../../types.js";',
				)
				.replace('import { Text } from "@mariozechner/pi-tui";', 'import { Text } from "@earendil-works/pi-tui";'),
	},
];

const PACKAGES = [
	{ id: "bash-timeout", packageDir: "pi-bash-timeout" },
	{ id: "gpt-apply-patch", packageDir: "pi-apply-patch" },
	{ id: "todowrite", packageDir: "pi-todotools" },
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
