export type CompactionQueuedMessage = {
	readonly text: string;
	readonly mode: "steer" | "followUp";
};

type TransferOptions = {
	readonly willRetry?: boolean;
};

type TransferDependencies = {
	readonly takeBatch: () => CompactionQueuedMessage[];
	readonly restoreUndelivered: (messages: readonly CompactionQueuedMessage[]) => void;
	readonly isCommand: (message: CompactionQueuedMessage) => boolean;
	readonly deliverCommand: (message: CompactionQueuedMessage) => Promise<void>;
	readonly deliverFirstPrompt: (message: CompactionQueuedMessage) => Promise<void>;
	readonly deliverQueued: (message: CompactionQueuedMessage) => Promise<void>;
	readonly reportFailure: (error: unknown, undeliveredCount: number) => void;
};

export async function transferCompactionQueue(
	dependencies: TransferDependencies,
	options: TransferOptions = {},
): Promise<void> {
	const batch = dependencies.takeBatch();
	if (batch.length === 0) return;

	let acceptedCount = 0;
	try {
		if (options.willRetry) {
			for (const message of batch) {
				if (dependencies.isCommand(message)) {
					await dependencies.deliverCommand(message);
				} else {
					await dependencies.deliverQueued(message);
				}
				acceptedCount += 1;
			}
			return;
		}

		const firstPromptIndex = batch.findIndex((message) => !dependencies.isCommand(message));
		if (firstPromptIndex === -1) {
			for (const message of batch) {
				await dependencies.deliverCommand(message);
				acceptedCount += 1;
			}
			return;
		}

		for (const message of batch.slice(0, firstPromptIndex)) {
			await dependencies.deliverCommand(message);
			acceptedCount += 1;
		}

		await dependencies.deliverFirstPrompt(batch[firstPromptIndex]);
		acceptedCount += 1;

		for (const message of batch.slice(firstPromptIndex + 1)) {
			if (dependencies.isCommand(message)) {
				await dependencies.deliverCommand(message);
			} else {
				await dependencies.deliverQueued(message);
			}
			acceptedCount += 1;
		}
	} catch (error) {
		const failure = error instanceof Error ? error : new Error(String(error));
		const undelivered = batch.slice(acceptedCount);
		dependencies.restoreUndelivered(undelivered);
		dependencies.reportFailure(failure, undelivered.length);
	}
}

export function waitForPromptAcceptance(
	startPrompt: (preflightResult: (success: boolean) => void) => Promise<void>,
	reportPostAcceptanceFailure: (error: unknown) => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let accepted = false;
		let rejectedAtPreflight = false;
		const prompt = startPrompt((success) => {
			if (success) {
				accepted = true;
				resolve();
			} else {
				rejectedAtPreflight = true;
			}
		});

		void prompt.then(
			() => {
				if (rejectedAtPreflight && !accepted) {
					reject(new Error("Queued prompt was rejected before acceptance"));
				}
			},
			(error: unknown) => {
				if (accepted) {
					reportPostAcceptanceFailure(error);
				} else {
					reject(error);
				}
			},
		);
	});
}
