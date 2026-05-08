import stripAnsi from "strip-ansi";
import { describe, expect, it, vi } from "vitest";

vi.mock("@mariozechner/pi-tui", () => ({
	visibleWidth: (text: string) => stripAnsi(text).length,
	truncateToWidth: (text: string, width: number, ellipsis = "") =>
		stripAnsi(text).length <= width ? text : `${text.slice(0, width - ellipsis.length)}${ellipsis}`,
}));
vi.mock("../src/modes/interactive/theme/theme.js", () => ({
	theme: {
		fg: (_color: string, text: string) => text,
	},
}));

function createSession(): unknown {
	const session = {
		state: {
			model: {
				id: "test-model",
				provider: "test",
				contextWindow: 1_600_000,
				reasoning: false,
			},
			thinkingLevel: "off",
		},
		sessionManager: {
			getEntries: () => [
				{
					type: "message",
					message: {
						role: "assistant",
						usage: {
							input: 49,
							output: 6_800,
							cacheRead: 1_500_000,
							cacheWrite: 44_000,
							cost: { total: 0 },
						},
					},
				},
			],
			getSessionName: () => "",
			getCwd: () => "/tmp/project",
		},
		getContextUsage: () => ({ contextWindow: 800_000, percent: 5.5 }),
		modelRegistry: {
			isUsingOAuth: () => false,
		},
	};

	return session;
}

function createFooterData(): unknown {
	return {
		getGitBranch: () => undefined,
		getExtensionStatuses: () => new Map<string, string>(),
		getAvailableProviderCount: () => 1,
		onBranchChange: () => () => {},
	};
}

describe("FooterComponent token formatting", () => {
	it("renders exact token counts instead of k/M abbreviations", async () => {
		const { FooterComponent } = await import("../src/modes/interactive/components/footer.js");
		const Footer = FooterComponent as new (
			session: unknown,
			footerData: unknown,
		) => { render(width: number): string[] };
		const footer = new Footer(createSession(), createFooterData());

		const rendered = stripAnsi(footer.render(160).join("\n"));

		expect(rendered).toContain("↑49");
		expect(rendered).toContain("↓6800");
		expect(rendered).toContain("R1500000");
		expect(rendered).toContain("W44000");
		expect(rendered).toContain("5.5%/800000 (auto)");
		expect(rendered).not.toContain("6.8k");
		expect(rendered).not.toContain("1.5M");
		expect(rendered).not.toContain("44k");
		expect(rendered).not.toContain("800k");
	});
});
