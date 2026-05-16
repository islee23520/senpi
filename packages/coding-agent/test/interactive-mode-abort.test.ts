import { describe, expect, test, vi } from "vitest";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.js";

type QueuedMessages = {
	steering: string[];
	followUp: string[];
};

type RestoreQueuedMessagesToEditorThis = {
	clearAllQueues: () => QueuedMessages;
	updatePendingMessagesDisplay: () => void;
	editor: {
		getText: () => string;
		setText: (text: string) => void;
	};
	session: {
		abort: () => Promise<void> | void;
	};
};

type RestoreQueuedMessagesToEditor = (
	this: RestoreQueuedMessagesToEditorThis,
	options?: { abort?: boolean; currentText?: string },
) => number;

function restoreQueuedMessagesToEditor(
	fakeThis: RestoreQueuedMessagesToEditorThis,
	options?: { abort?: boolean; currentText?: string },
): number {
	const descriptor = Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "restoreQueuedMessagesToEditor");
	const restore = descriptor?.value as RestoreQueuedMessagesToEditor | undefined;
	if (!restore) {
		throw new Error("restoreQueuedMessagesToEditor is missing");
	}
	return restore.call(fakeThis, options);
}

type AbortAndFireQueuedMessagesThis = {
	clearAllQueues: () => QueuedMessages;
	updatePendingMessagesDisplay: () => void;
	session: {
		abort: () => Promise<void>;
		prompt: (text: string) => Promise<void>;
	};
	showError: (message: string) => void;
};

type AbortAndFireQueuedMessages = (this: AbortAndFireQueuedMessagesThis) => Promise<number>;

function abortAndFireQueuedMessages(fakeThis: AbortAndFireQueuedMessagesThis): Promise<number> {
	const descriptor = Object.getOwnPropertyDescriptor(InteractiveMode.prototype, "abortAndFireQueuedMessages");
	const fn = descriptor?.value as AbortAndFireQueuedMessages | undefined;
	if (!fn) {
		throw new Error("abortAndFireQueuedMessages is missing");
	}
	return fn.call(fakeThis);
}

describe("InteractiveMode.restoreQueuedMessagesToEditor", () => {
	test("aborts through the session after restoring queued messages", () => {
		// given
		const abort = vi.fn<() => void>();
		const setText = vi.fn<(text: string) => void>();
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const fakeThis = {
			clearAllQueues: () => ({
				steering: ["Steering message"],
				followUp: ["Follow-up message"],
			}),
			updatePendingMessagesDisplay,
			editor: {
				getText: () => "current draft",
				setText,
			},
			session: { abort },
		} satisfies RestoreQueuedMessagesToEditorThis;

		// when
		const restoredCount = restoreQueuedMessagesToEditor(fakeThis, { abort: true });

		// then
		expect(restoredCount).toBe(2);
		expect(setText).toHaveBeenCalledWith("Steering message\n\nFollow-up message\n\ncurrent draft");
		expect(updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	test("aborts through the session when no queued message exists", () => {
		// given
		const abort = vi.fn<() => void>();
		const setText = vi.fn<(text: string) => void>();
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const fakeThis = {
			clearAllQueues: () => ({ steering: [], followUp: [] }),
			updatePendingMessagesDisplay,
			editor: {
				getText: () => "",
				setText,
			},
			session: { abort },
		} satisfies RestoreQueuedMessagesToEditorThis;

		// when
		const restoredCount = restoreQueuedMessagesToEditor(fakeThis, { abort: true });

		// then
		expect(restoredCount).toBe(0);
		expect(setText).not.toHaveBeenCalled();
		expect(updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);
	});

	test("restores queued messages before async abort settles", async () => {
		// given
		let resolveAbort: (() => void) | undefined;
		const abortSettled = new Promise<void>((resolve) => {
			resolveAbort = resolve;
		});
		const abort = vi.fn<() => Promise<void>>(() => abortSettled);
		const setText = vi.fn<(text: string) => void>();
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const fakeThis = {
			clearAllQueues: () => ({
				steering: ["queued before abort"],
				followUp: [],
			}),
			updatePendingMessagesDisplay,
			editor: {
				getText: () => "",
				setText,
			},
			session: { abort },
		} satisfies RestoreQueuedMessagesToEditorThis;

		// when
		const restoredCount = restoreQueuedMessagesToEditor(fakeThis, { abort: true });

		// then
		expect(restoredCount).toBe(1);
		expect(setText).toHaveBeenCalledWith("queued before abort");
		expect(updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(abort).toHaveBeenCalledTimes(1);

		resolveAbort?.();
		await abortSettled;
	});
});

describe("InteractiveMode.abortAndFireQueuedMessages", () => {
	test("clears queue, aborts, then auto-fires queued messages as a single fresh prompt", async () => {
		// given
		const callOrder: string[] = [];
		const abort = vi.fn<() => Promise<void>>(async () => {
			callOrder.push("abort");
		});
		const prompt = vi.fn<(text: string) => Promise<void>>(async (text: string) => {
			callOrder.push(`prompt:${text}`);
		});
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const showError = vi.fn<(message: string) => void>();
		const fakeThis: AbortAndFireQueuedMessagesThis = {
			clearAllQueues: () => ({
				steering: ["msg-a", "msg-b"],
				followUp: ["msg-c"],
			}),
			updatePendingMessagesDisplay,
			session: { abort, prompt },
			showError,
		};

		// when
		const fired = await abortAndFireQueuedMessages(fakeThis);

		// then
		expect(fired).toBe(3);
		expect(callOrder).toEqual(["abort", "prompt:msg-a\n\nmsg-b\n\nmsg-c"]);
		expect(updatePendingMessagesDisplay).toHaveBeenCalledTimes(1);
		expect(showError).not.toHaveBeenCalled();
	});

	test("aborts but does not fire any prompt when no messages are queued", async () => {
		// given
		const abort = vi.fn<() => Promise<void>>(async () => {});
		const prompt = vi.fn<(text: string) => Promise<void>>(async () => {});
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const showError = vi.fn<(message: string) => void>();
		const fakeThis: AbortAndFireQueuedMessagesThis = {
			clearAllQueues: () => ({ steering: [], followUp: [] }),
			updatePendingMessagesDisplay,
			session: { abort, prompt },
			showError,
		};

		// when
		const fired = await abortAndFireQueuedMessages(fakeThis);

		// then
		expect(fired).toBe(0);
		expect(abort).toHaveBeenCalledTimes(1);
		expect(prompt).not.toHaveBeenCalled();
		expect(showError).not.toHaveBeenCalled();
	});

	test("waits for abort to fully settle before firing the queued prompt", async () => {
		// given
		let resolveAbort: (() => void) | undefined;
		const abortSettled = new Promise<void>((resolve) => {
			resolveAbort = resolve;
		});
		const abort = vi.fn<() => Promise<void>>(() => abortSettled);
		const prompt = vi.fn<(text: string) => Promise<void>>(async () => {});
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const showError = vi.fn<(message: string) => void>();
		const fakeThis: AbortAndFireQueuedMessagesThis = {
			clearAllQueues: () => ({ steering: ["queued"], followUp: [] }),
			updatePendingMessagesDisplay,
			session: { abort, prompt },
			showError,
		};

		// when
		const promise = abortAndFireQueuedMessages(fakeThis);

		// Yield the microtask queue so the helper reaches its `await session.abort()`.
		await Promise.resolve();
		await Promise.resolve();

		// then: prompt has not been called yet because abort hasn't settled
		expect(prompt).not.toHaveBeenCalled();

		// Resolve abort and let the helper continue
		resolveAbort?.();
		const fired = await promise;

		expect(fired).toBe(1);
		expect(prompt).toHaveBeenCalledWith("queued");
	});

	test("surfaces fresh prompt errors via showError without throwing", async () => {
		// given
		const abort = vi.fn<() => Promise<void>>(async () => {});
		const prompt = vi.fn<(text: string) => Promise<void>>(async () => {
			throw new Error("no model selected");
		});
		const updatePendingMessagesDisplay = vi.fn<() => void>();
		const showError = vi.fn<(message: string) => void>();
		const fakeThis: AbortAndFireQueuedMessagesThis = {
			clearAllQueues: () => ({ steering: ["msg"], followUp: [] }),
			updatePendingMessagesDisplay,
			session: { abort, prompt },
			showError,
		};

		// when
		const fired = await abortAndFireQueuedMessages(fakeThis);

		// then: helper returns the count and reports the error via showError
		expect(fired).toBe(1);
		expect(prompt).toHaveBeenCalledWith("msg");
		expect(showError).toHaveBeenCalledTimes(1);
		expect(showError.mock.calls[0][0]).toContain("no model selected");
	});
});
