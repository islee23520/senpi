import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupHooksCommandHarnesses,
	createHooksCommandHarness,
	firstHookId,
	lastNotification,
	readState,
} from "./hooks-command-harness.ts";

const USAGE = "Usage: /hooks [list|diagnostics|trust <id>|disable <id>|enable <id>|reload]";
const SECRET = "sk-test-secret-should-not-render";
const API_KEY_SECRET = "plain-api-key-value-should-not-render";
const PASSWORD_SECRET = "plain-password-value-should-not-render";

afterEach(() => {
	cleanupHooksCommandHarnesses();
});

describe("builtin hooks /hooks command", () => {
	it("lists hook trust status without calling the provider", async () => {
		const setup = await createHooksCommandHarness({
			projectHooks: {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{
									type: "command",
									command: `node hooks/pre-tool.mjs --token ${SECRET}`,
									statusMessage: "checking command",
								},
							],
						},
					],
					PostToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "node hooks/post-tool.mjs" }],
						},
					],
					SessionStart: [
						{
							matcher: "startup",
							hooks: [{ type: "command", command: "node hooks/session-start.mjs" }],
						},
					],
				},
			},
		});

		await setup.harness.session.prompt("/hooks");

		const message = lastNotification(setup.notifications).message;
		expect(message).toContain("hooks: 3 executable hooks");
		expect(message).toContain("PreToolUse:1");
		expect(message).toContain("PostToolUse:1");
		expect(message).toContain("SessionStart:1");
		expect(message).toContain("untrusted");
		expect(message).toContain("disabled:false");
		expect(message).toContain("node hooks/pre-tool.mjs --token [redacted]");
		expect(message).not.toContain(SECRET);
		expect(setup.harness.getPendingResponseCount()).toBe(0);
		expect(setup.payloads).toEqual([]);
	});

	it("redacts secret assignment flags and quoted values without over-redacting ordinary text", async () => {
		const setup = await createHooksCommandHarness({
			projectHooks: {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{
									type: "command",
									command: `node hooks/pre-tool.mjs --api-key=${API_KEY_SECRET} --password="${PASSWORD_SECRET}" --label=keep-visible password-report`,
								},
							],
						},
					],
				},
			},
		});

		await setup.harness.session.prompt("/hooks");

		const message = lastNotification(setup.notifications).message;
		expect(message).toContain("command:node hooks/pre-tool.mjs");
		expect(message).toContain("--api-key=[redacted]");
		expect(message).toContain("--password=[redacted]");
		expect(message).toContain("--label=keep-visible password-report");
		expect(message).not.toContain(API_KEY_SECRET);
		expect(message).not.toContain(PASSWORD_SECRET);
		expect(setup.payloads).toEqual([]);
	});

	it("prints diagnostics separately without raw hook command output", async () => {
		const setup = await createHooksCommandHarness({
			projectHooks: {
				hooks: {
					PreToolUse: [
						{
							hooks: [
								{
									type: "command",
									command: "node hooks/ok.mjs",
									shell: SECRET,
								},
							],
						},
					],
					UnsupportedFutureEvent: [{ hooks: [{ type: "command", command: `echo ${SECRET}` }] }],
				},
			},
		});

		await setup.harness.session.prompt("/hooks diagnostics");

		const message = lastNotification(setup.notifications).message;
		expect(message).toContain("hooks diagnostics: 2 diagnostics");
		expect(message).toContain("warning: unsupported_field");
		expect(message).toContain("warning: unknown_event");
		expect(message).not.toContain(SECRET);
		expect(message).not.toContain("echo ");
	});

	it("trusts, disables, and enables current hook IDs", async () => {
		const setup = await createHooksCommandHarness({
			projectHooks: {
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [{ type: "command", command: "node hooks/pre-tool.mjs" }],
						},
					],
				},
			},
		});
		await setup.harness.session.prompt("/hooks list");
		const id = firstHookId(lastNotification(setup.notifications).message);

		await setup.harness.session.prompt(`/hooks trust ${id}`);
		expect(lastNotification(setup.notifications).message).toBe(`Trusted hook: ${id}`);
		expect(readState(setup.projectStatePath).hooks[id]?.trustedHash).toMatch(/^sha256:/);
		expect(readState(setup.projectStatePath).hooks[id]?.enabled).toBe(true);
		await setup.harness.session.prompt("/hooks list");
		expect(lastNotification(setup.notifications).message).toContain(
			`- ${id} PreToolUse source:project status:trusted`,
		);
		expect(lastNotification(setup.notifications).message).toContain("disabled:false");

		await setup.harness.session.prompt(`/hooks disable ${id}`);
		expect(lastNotification(setup.notifications).message).toBe(`Disabled hook: ${id}`);
		expect(readState(setup.projectStatePath).hooks[id]?.enabled).toBe(false);
		await setup.harness.session.prompt("/hooks list");
		expect(lastNotification(setup.notifications).message).toContain(
			`- ${id} PreToolUse source:project status:trusted`,
		);
		expect(lastNotification(setup.notifications).message).toContain("disabled:true");

		await setup.harness.session.prompt(`/hooks enable ${id}`);
		expect(lastNotification(setup.notifications).message).toBe(`Enabled hook: ${id}`);
		expect(readState(setup.projectStatePath).hooks[id]?.enabled).toBe(true);
		await setup.harness.session.prompt("/hooks list");
		expect(lastNotification(setup.notifications).message).toContain(
			`- ${id} PreToolUse source:project status:trusted`,
		);
		expect(lastNotification(setup.notifications).message).toContain("disabled:false");
	});

	it("does not mutate state for unknown hook IDs", async () => {
		const setup = await createHooksCommandHarness({
			projectHooks: {
				hooks: {
					PreToolUse: [{ hooks: [{ type: "command", command: "node hooks/pre-tool.mjs" }] }],
				},
			},
		});
		await setup.harness.session.prompt("/hooks list");
		const before = existsSync(setup.projectStatePath) ? readFileSync(setup.projectStatePath, "utf-8") : "";

		await setup.harness.session.prompt("/hooks trust missing-hook-id");

		const after = existsSync(setup.projectStatePath) ? readFileSync(setup.projectStatePath, "utf-8") : "";
		const notification = lastNotification(setup.notifications);
		expect(notification).toEqual({ message: "Hook not found: missing-hook-id", type: "error" });
		expect(after).toBe(before);
	});

	it("prints exact usage for malformed input", async () => {
		const setup = await createHooksCommandHarness({ projectHooks: { hooks: {} } });

		for (const command of [
			"/hooks wat",
			"/hooks trust",
			"/hooks disable",
			"/hooks enable",
			"/hooks diagnostics extra",
			"/hooks reload extra",
		]) {
			await setup.harness.session.prompt(command);
			expect(lastNotification(setup.notifications)).toEqual({ message: USAGE, type: "error" });
		}
	});

	it("reloads hook sources before reporting status", async () => {
		const setup = await createHooksCommandHarness({ projectHooks: { hooks: {} } });

		writeFileSync(
			setup.projectHooksPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [{ hooks: [{ type: "command", command: "node hooks/reloaded.mjs" }] }],
				},
			}),
			"utf-8",
		);
		await setup.harness.session.prompt("/hooks reload");

		expect(setup.reloadCalls).toBe(1);
		const message = lastNotification(setup.notifications).message;
		expect(message).toContain("Reloaded hooks.");
		expect(message).toContain("hooks: 1 executable hooks");
		expect(message).toContain("node hooks/reloaded.mjs");
	});

	it("exposes subcommand argument completions", async () => {
		const setup = await createHooksCommandHarness({ projectHooks: { hooks: {} } });
		const command = setup.harness.session.extensionRunner.getCommand("hooks");

		await expect(command?.getArgumentCompletions?.("d")).resolves.toEqual([
			{ value: "diagnostics", label: "diagnostics" },
			{ value: "disable", label: "disable" },
		]);
		await expect(command?.getArgumentCompletions?.("trust ")).resolves.toEqual([]);
	});
});
