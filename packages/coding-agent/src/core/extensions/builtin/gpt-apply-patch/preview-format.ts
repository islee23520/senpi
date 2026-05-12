import path from "node:path";
import * as Diff from "diff";
import { getLanguageFromPath, highlightCode } from "../../../../modes/interactive/theme/theme.js";
import { parsePatch } from "./parser.js";
import { extractPatchedPaths } from "./text.js";
import type {
	ApplyPatchOperation,
	ApplyPatchPreview,
	ApplyPatchPreviewFile,
	ApplyPatchRenderState,
	ApplyPatchTheme,
} from "./types.js";

export const PATCH_PREVIEW_MAX_LINES = 16;
export const PATCH_PREVIEW_MAX_CHARS = 4000;
const PATCH_PREVIEW_HEAD_LINES = 8;
const PATCH_PREVIEW_TAIL_LINES = 8;
const applyPatchRenderStates = new Map<string, ApplyPatchRenderState>();

function isChangedPreviewLine(line: string): boolean {
	return /^[+-]\s*\d+\s/.test(line);
}

function countWindowLines(lines: string[], start: number, end: number): number {
	return end - start + (start > 0 ? 1 : 0) + (end < lines.length ? 1 : 0);
}

function formatPreviewWindow(lines: string[], start: number, end: number): string {
	const previewLines = lines.slice(start, end);
	if (start > 0) previewLines.unshift("…");
	if (end < lines.length) previewLines.push("…");
	return previewLines.join("\n");
}

function createChangedHunkPreview(lines: string[]): string | undefined {
	const firstChangedLine = lines.findIndex(isChangedPreviewLine);
	if (firstChangedLine === -1) return undefined;

	let start = firstChangedLine;
	let end = firstChangedLine + 1;
	while (end < lines.length) {
		const line = lines[end];
		if (line === undefined || !isChangedPreviewLine(line)) break;
		end++;
	}

	const changedHunkEnd = end;
	while (end > start && countWindowLines(lines, start, end) > PATCH_PREVIEW_MAX_LINES) end--;

	while (countWindowLines(lines, start, end) < PATCH_PREVIEW_MAX_LINES) {
		const canAddBefore = start > 0;
		const canAddAfter = end < lines.length;
		if (!canAddBefore && !canAddAfter) break;

		const beforeContextLines = firstChangedLine - start;
		const afterContextLines = end - changedHunkEnd;
		if (canAddBefore && (!canAddAfter || beforeContextLines <= afterContextLines)) {
			start--;
		} else {
			end++;
		}
	}

	return formatPreviewWindow(lines, start, end);
}

function formatLineCountSummary(added: number, removed: number): string {
	return `(+${added} -${removed})`;
}

function countLines(text: string): number {
	if (text.length === 0) return 0;
	let lines = 1;
	for (let index = 0; index < text.length; index++) {
		if (text.charCodeAt(index) === 10) lines += 1;
	}
	return lines;
}

export function truncatePreview(text: string): string {
	if (text.length <= PATCH_PREVIEW_MAX_CHARS && countLines(text) <= PATCH_PREVIEW_MAX_LINES) return text;
	const lines = text.split("\n");
	const changedHunkPreview = createChangedHunkPreview(lines);
	let preview =
		changedHunkPreview ??
		[...lines.slice(0, PATCH_PREVIEW_HEAD_LINES), "…", ...lines.slice(-PATCH_PREVIEW_TAIL_LINES)].join("\n");
	if (preview.length > PATCH_PREVIEW_MAX_CHARS) preview = `${preview.slice(0, PATCH_PREVIEW_MAX_CHARS).trimEnd()}\n…`;
	return preview;
}

export function displayPath(filePath: string, cwd: string): string {
	if (!path.isAbsolute(filePath)) return filePath;
	const absoluteCwd = path.resolve(cwd);
	const relativePath = path.relative(absoluteCwd, filePath);
	if (
		relativePath === "" ||
		(!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
	) {
		return relativePath || ".";
	}
	return filePath;
}

function formatPatchFilePath(file: ApplyPatchPreviewFile, cwd: string = process.cwd()): string {
	const filePath = displayPath(file.filePath, cwd);
	if (!file.movePath) return filePath;
	return `${filePath} → ${displayPath(file.movePath, cwd)}`;
}

function formatPatchOperation(operation: ApplyPatchOperation): string {
	if (operation === "add") return "Added";
	if (operation === "delete") return "Deleted";
	return "Edited";
}

export function formatPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string = process.cwd(),
	expanded: boolean = true,
): string {
	const lines: string[] = [];
	if (preview.files.length === 1) {
		const file = preview.files[0];
		if (file) {
			lines.push(
				`• ${formatPatchOperation(file.operation)} ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`,
			);
			if (expanded && file.diff)
				lines.push(
					...truncatePreview(file.diff)
						.split("\n")
						.map((line) => `  ${line}`),
				);
		}
		return lines.join("\n");
	}

	const noun = preview.files.length === 1 ? "file" : "files";
	lines.push(`• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}`);
	for (const file of preview.files) {
		lines.push(`  └ ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`);
		if (expanded && file.diff)
			lines.push(
				...truncatePreview(file.diff)
					.split("\n")
					.map((line) => `    ${line}`),
			);
	}
	return lines.join("\n");
}

export function formatInFlightCallText(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) return "Patching";
	const noun = paths.length === 1 ? "file" : "files";
	const count = paths.length > 1 ? ` (${paths.length} ${noun})` : "";
	return `Patching${count}: ${paths.join(", ")}`;
}

type RenderableAddedDiffLine = { content: string; kind: "added"; lineNumber: string; sign: "+" };
type RenderableRemovedDiffLine = { content: string; kind: "removed"; lineNumber: string; sign: "-" };
type RenderableContextDiffLine = { content: string; kind: "context"; lineNumber: string; sign: " " };
type RenderableContentDiffLine = RenderableAddedDiffLine | RenderableContextDiffLine | RenderableRemovedDiffLine;
type RenderableDiffLine = RenderableContentDiffLine | { kind: "meta"; text: string };

function parseRenderableDiffLine(line: string): RenderableDiffLine {
	const match = line.match(/^([+\- ])(\s*\d+)\s(.*)$/);
	if (!match) return { kind: "meta", text: line };

	const sign = match[1];
	const lineNumber = match[2];
	if ((sign !== "+" && sign !== "-" && sign !== " ") || lineNumber === undefined) return { kind: "meta", text: line };

	const content = match[3] ?? "";
	if (sign === "+") return { content, kind: "added", lineNumber, sign };
	if (sign === "-") return { content, kind: "removed", lineNumber, sign };
	return { content, kind: "context", lineNumber, sign };
}

function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

function highlightDiffContent(content: string, filePath: string): string {
	const plainContent = replaceTabs(content);
	const language = getLanguageFromPath(filePath);
	try {
		return highlightCode(plainContent, language)[0] ?? plainContent;
	} catch {
		return plainContent;
	}
}

function renderInlineDiff(
	oldContent: string,
	newContent: string,
	theme: ApplyPatchTheme,
): { added: string; removed: string } {
	const parts = Diff.diffWords(replaceTabs(oldContent), replaceTabs(newContent));
	let added = "";
	let removed = "";
	let firstAdded = true;
	let firstRemoved = true;

	for (const part of parts) {
		if (part.added) {
			let value = part.value;
			if (firstAdded) {
				const leadingWhitespace = value.match(/^(\s*)/)?.[1] ?? "";
				added += leadingWhitespace;
				value = value.slice(leadingWhitespace.length);
				firstAdded = false;
			}
			if (value) added += theme.inverse(value);
			continue;
		}

		if (part.removed) {
			let value = part.value;
			if (firstRemoved) {
				const leadingWhitespace = value.match(/^(\s*)/)?.[1] ?? "";
				removed += leadingWhitespace;
				value = value.slice(leadingWhitespace.length);
				firstRemoved = false;
			}
			if (value) removed += theme.inverse(value);
			continue;
		}

		added += part.value;
		removed += part.value;
	}

	return { added, removed };
}

function renderOpenCodeLikeDiffLine(
	line: RenderableContentDiffLine,
	filePath: string,
	theme: ApplyPatchTheme,
	contentOverride?: string,
): string {
	const lineNumber = theme.fg("muted", line.lineNumber);
	if (line.kind === "context") {
		return `${theme.fg("toolDiffContext", line.sign)}${lineNumber} ${highlightDiffContent(line.content, filePath)}`;
	}

	const diffColor = line.kind === "added" ? "toolDiffAdded" : "toolDiffRemoved";
	const background = line.kind === "added" ? "toolSuccessBg" : "toolErrorBg";
	const content =
		contentOverride === undefined
			? highlightDiffContent(line.content, filePath)
			: theme.fg(diffColor, replaceTabs(contentOverride));
	const rendered = `${theme.fg(diffColor, line.sign)}${lineNumber} ${content}`;
	return theme.bg(background, rendered);
}

function renderOpenCodeLikeDiff(diffText: string, filePath: string, theme: ApplyPatchTheme): string {
	const parsedLines = diffText.split("\n").map(parseRenderableDiffLine);
	const rendered: string[] = [];
	let index = 0;

	while (index < parsedLines.length) {
		const line = parsedLines[index];
		if (!line) {
			index++;
			continue;
		}

		if (line.kind !== "removed") {
			rendered.push(
				line.kind === "meta"
					? theme.fg("toolDiffContext", line.text)
					: renderOpenCodeLikeDiffLine(line, filePath, theme),
			);
			index++;
			continue;
		}

		const removedLines: RenderableRemovedDiffLine[] = [];
		while (parsedLines[index]?.kind === "removed") {
			const removedLine = parsedLines[index];
			if (removedLine?.kind === "removed") removedLines.push(removedLine);
			index++;
		}

		const addedLines: RenderableAddedDiffLine[] = [];
		while (parsedLines[index]?.kind === "added") {
			const addedLine = parsedLines[index];
			if (addedLine?.kind === "added") addedLines.push(addedLine);
			index++;
		}

		const pairedCount = Math.min(removedLines.length, addedLines.length);
		for (let pairIndex = 0; pairIndex < pairedCount; pairIndex++) {
			const removedLine = removedLines[pairIndex];
			const addedLine = addedLines[pairIndex];
			if (!removedLine || !addedLine) continue;

			const inline = renderInlineDiff(removedLine.content, addedLine.content, theme);
			rendered.push(renderOpenCodeLikeDiffLine(removedLine, filePath, theme, inline.removed));
			rendered.push(renderOpenCodeLikeDiffLine(addedLine, filePath, theme, inline.added));
		}

		for (const removedLine of removedLines.slice(pairedCount))
			rendered.push(renderOpenCodeLikeDiffLine(removedLine, filePath, theme));
		for (const addedLine of addedLines.slice(pairedCount))
			rendered.push(renderOpenCodeLikeDiffLine(addedLine, filePath, theme));
	}

	return rendered.join("\n");
}

export function getApplyPatchRenderState(toolCallId: string, cwd: string, patchText: string): ApplyPatchRenderState {
	const existing = applyPatchRenderStates.get(toolCallId);
	if (existing && existing.cwd === cwd && existing.patchText === patchText) return existing;

	const callText = formatInFlightCallText(patchText);
	let collapsed = "";
	let expanded = "";
	try {
		const hunks = parsePatch(patchText);
		if (hunks.length > 0) {
			const files = hunks.map((hunk) => ({
				filePath: hunk.filePath,
				movePath: hunk.type === "update" ? hunk.movePath : undefined,
				operation: hunk.type,
				diff: "",
				added: 0,
				removed: 0,
			})) satisfies ApplyPatchPreviewFile[];
			const preview: ApplyPatchPreview = { files, added: 0, removed: 0 };
			collapsed = formatPatchPreview(preview, cwd, false);
			expanded = formatPatchPreview(preview, cwd, true);
		}
	} catch {
		// ignore incomplete patch text
	}

	const nextState: ApplyPatchRenderState = { ...existing, cwd, patchText, callText, collapsed, expanded };
	applyPatchRenderStates.set(toolCallId, nextState);
	return nextState;
}

export function clearApplyPatchRenderState(): void {
	applyPatchRenderStates.clear();
}

export function renderPatchPreview(
	preview: ApplyPatchPreview,
	cwd: string,
	theme: ApplyPatchTheme,
	expanded: boolean,
): string {
	if (expanded) {
		try {
			const renderFile = (file: ApplyPatchPreviewFile, headerPrefix: string): string => {
				const header = `• ${formatPatchOperation(file.operation)} ${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`;
				if (!file.diff) {
					return headerPrefix.length > 0
						? `${headerPrefix}${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`
						: header;
				}

				const renderedDiff = renderOpenCodeLikeDiff(
					truncatePreview(file.diff),
					file.movePath ?? file.filePath,
					theme,
				);
				if (headerPrefix.length > 0) {
					const nestedHeader = `${headerPrefix}${formatPatchFilePath(file, cwd)} ${formatLineCountSummary(file.added, file.removed)}`;
					return `${nestedHeader}\n${renderedDiff
						.split("\n")
						.map((line) => `    ${line}`)
						.join("\n")}`;
				}
				return `${header}\n${renderedDiff}`;
			};

			if (preview.files.length === 1) {
				const file = preview.files[0];
				return file ? renderFile(file, "") : "";
			}

			const noun = preview.files.length === 1 ? "file" : "files";
			const renderedFiles = preview.files.map((file) => renderFile(file, "  └ ")).join("\n");
			if (renderedFiles.length > 0) {
				return `• Edited ${preview.files.length} ${noun} ${formatLineCountSummary(preview.added, preview.removed)}\n${renderedFiles}`;
			}
		} catch {
			// fall back to manual themed line rendering
		}
	}

	return formatPatchPreview(preview, cwd, expanded)
		.split("\n")
		.map((line) => renderPatchLine(line, theme))
		.join("\n");
}

export function formatPendingPatchPaths(patchText: string): string {
	const paths = extractPatchedPaths(patchText);
	if (paths.length === 0) return "Applying patch...";
	return `Applying patch...\n${paths.map((filePath) => `• ${filePath}`).join("\n")}`;
}

export function renderPatchLine(line: string, theme: ApplyPatchTheme): string {
	const trimmed = line.trimStart();
	if (trimmed.startsWith("+")) return theme.fg("toolDiffAdded", line);
	if (trimmed.startsWith("-")) return theme.fg("toolDiffRemoved", line);
	if (trimmed.startsWith("•")) return theme.fg("toolTitle", theme.bold(line));
	if (trimmed.startsWith("└")) return theme.fg("accent", line);
	return theme.fg("toolDiffContext", line);
}
