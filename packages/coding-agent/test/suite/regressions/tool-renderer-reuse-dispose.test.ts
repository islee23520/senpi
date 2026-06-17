import { type Component, Container, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { describe, expect, test } from "vitest";
import type { ToolDefinition, ToolRenderContext } from "../../../src/core/extensions/types.ts";
import { createBashToolDefinition } from "../../../src/core/tools/bash.ts";
import { createEditToolDefinition } from "../../../src/core/tools/edit.ts";
import { createWriteToolDefinition } from "../../../src/core/tools/write.ts";
import { ToolExecutionComponent } from "../../../src/modes/interactive/components/tool-execution.ts";
import { initTheme, theme } from "../../../src/modes/interactive/theme/theme.ts";

class DisposeSpy implements Component {
	disposeCount = 0;

	render(_width: number): string[] {
		return ["dispose-spy"];
	}

	invalidate(): void {}

	dispose(): void {
		this.disposeCount += 1;
	}
}

function createFakeTui(): TUI {
	return {
		requestRender: () => {},
	} as TUI;
}

const customSchema = Type.Object({
	value: Type.String(),
});

function createRenderContext<TState, TArgs>(
	args: TArgs,
	state: TState,
	lastComponent: Component | undefined,
): ToolRenderContext<TState, TArgs> {
	return {
		args,
		toolCallId: "call-reuse-renderer",
		invalidate: () => {},
		lastComponent,
		state,
		cwd: process.cwd(),
		executionStarted: true,
		argsComplete: true,
		isPartial: false,
		expanded: false,
		showImages: true,
		isError: false,
	};
}

function expectContainer(component: Component | undefined): Container {
	expect(component).toBeInstanceOf(Container);
	if (!(component instanceof Container)) {
		throw new Error("expected renderer to return a Container");
	}
	return component;
}

describe("tool renderer component reuse", () => {
	test("does not dispose a self-rendered call component before it is passed back as lastComponent", () => {
		initTheme("dark");
		const reusableChild = new DisposeSpy();
		const toolDefinition: ToolDefinition<typeof customSchema, unknown, Record<string, never>> = {
			name: "custom_reuse",
			label: "custom_reuse",
			description: "custom renderer reuse regression",
			parameters: customSchema,
			renderShell: "self",
			execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
			renderCall: (args, _theme, context) => {
				const component = context.lastComponent instanceof Container ? context.lastComponent : new Container();
				if (component.children.length === 0) {
					component.addChild(reusableChild);
				}
				component.addChild(new Text(args.value, 0, 0));
				return component;
			},
		};
		const component = new ToolExecutionComponent(
			"custom_reuse",
			"call-reuse-renderer",
			{ value: "first" },
			{},
			toolDefinition,
			createFakeTui(),
			process.cwd(),
		);

		component.updateArgs({ value: "second" });

		expect(reusableChild.disposeCount).toBe(0);
	});

	test("does not dispose renderer-owned children while rebuilding reusable built-in result containers", () => {
		initTheme("dark");
		const result = { content: [], details: undefined };
		const options = { expanded: false, isPartial: false };
		const editTool = createEditToolDefinition(process.cwd());
		const editComponent = expectContainer(
			editTool.renderResult?.(result, options, theme, {
				...createRenderContext({ path: "notes.txt", edits: [] }, {}, undefined),
			}),
		);
		const editChild = new DisposeSpy();
		editComponent.addChild(editChild);

		editTool.renderResult?.(result, options, theme, {
			...createRenderContext({ path: "notes.txt", edits: [] }, {}, editComponent),
		});

		expect(editChild.disposeCount).toBe(0);

		const writeTool = createWriteToolDefinition(process.cwd());
		const writeComponent = expectContainer(
			writeTool.renderResult?.(result, options, theme, {
				...createRenderContext({ path: "notes.txt", content: "hello" }, {}, undefined),
			}),
		);
		const writeChild = new DisposeSpy();
		writeComponent.addChild(writeChild);

		writeTool.renderResult?.(result, options, theme, {
			...createRenderContext({ path: "notes.txt", content: "hello" }, {}, writeComponent),
		});

		expect(writeChild.disposeCount).toBe(0);

		const bashTool = createBashToolDefinition(process.cwd());
		const bashState = { startedAt: undefined, endedAt: undefined, interval: undefined };
		const bashComponent = expectContainer(
			bashTool.renderResult?.(result, options, theme, {
				...createRenderContext({ command: "echo hello" }, bashState, undefined),
			}),
		);
		const bashChild = new DisposeSpy();
		bashComponent.addChild(bashChild);

		bashTool.renderResult?.(result, options, theme, {
			...createRenderContext({ command: "echo hello" }, bashState, bashComponent),
		});

		expect(bashChild.disposeCount).toBe(0);
	});
});
