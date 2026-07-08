// Server logging notifications (todo 42): RFC-5424 levels fold onto the
// logger's four methods, config logLevel filters below-threshold messages,
// and a 10/s token bucket absorbs floods without losing steady-state flow.
// (Tool-call progress → onUpdate is W4 behavior, covered by the tier-B and
// register tests plus the real-surface driver.)

import { describe, expect, it } from "vitest";
import { subscribeMcpServerLogging } from "../../src/core/extensions/builtin/mcp/logging.ts";

type Handler = (notification: { params: { level: string; data: unknown; logger?: string } }) => void;

function harness(options: { logLevel?: string; now?: () => number } = {}) {
	let handler: Handler = () => undefined;
	const client = { setNotificationHandler: (_schema: unknown, callback: Handler) => (handler = callback) };
	const lines: string[] = [];
	const logger = {
		debug: (message: string) => lines.push(`debug ${message}`),
		error: (message: string) => lines.push(`error ${message}`),
		info: (message: string) => lines.push(`info ${message}`),
		warn: (message: string) => lines.push(`warn ${message}`),
	};
	subscribeMcpServerLogging(client as never, { logger: logger as never, ...options });
	return {
		emit: (level: string, data: unknown, name?: string) => handler({ params: { data, level, logger: name } }),
		lines,
	};
}

describe("mcp server logging", () => {
	it("maps RFC-5424 levels onto logger methods with server logger names", () => {
		const { emit, lines } = harness();
		emit("debug", "d");
		emit("notice", "n", "sub");
		emit("warning", "w");
		emit("critical", "c");
		expect(lines).toEqual(["debug [server] d", "info [server:sub] n", "warn [server] w", "error [server] c"]);
	});

	it("filters below the configured logLevel", () => {
		const { emit, lines } = harness({ logLevel: "warning" });
		emit("debug", "hidden");
		emit("info", "hidden");
		emit("error", "kept");
		expect(lines).toEqual(["error [server] kept"]);
	});

	it("rate-limits a flood without losing steady-state messages", () => {
		let clock = 0;
		const { emit, lines } = harness({ now: () => clock });
		for (let i = 0; i < 100; i += 1) emit("info", `burst-${i}`);
		expect(lines.length).toBe(10);
		// A second later the bucket refills: the next message lands.
		clock = 1000;
		emit("info", "after-burst");
		expect(lines.at(-1)).toBe("info [server] after-burst");
	});
});
