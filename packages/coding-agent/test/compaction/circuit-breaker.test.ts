import { fauxOverflowError, registerFauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isTripped,
	recordFailure,
	recordSuccess,
	shouldBypass,
} from "../../src/core/extensions/builtin/compaction/circuit-breaker.ts";

interface FutureBreakerState {
	consecutiveFailures: number;
	trippedAt: number | null;
}

interface BreakerNotification {
	tripped: true;
	failureCount: number;
	trippedAt: number;
	reason: string;
}

interface RecordFailureOptions {
	onTrip?: (notification: BreakerNotification) => void;
	route?: "overflow" | "threshold" | "manual" | "extension" | "branch" | "pre_prompt";
}

type RecordFailureFn = (state: FutureBreakerState, now: number, opts?: RecordFailureOptions) => FutureBreakerState;
type RecordSuccessFn = (state: FutureBreakerState) => FutureBreakerState;
type IsTrippedFn = (state: FutureBreakerState, now: number) => boolean;
type ShouldBypassFn = (state: FutureBreakerState, opts?: { manual?: boolean }) => boolean;

const recordFailureFuture = recordFailure as unknown as RecordFailureFn;
const recordSuccessFuture = recordSuccess as unknown as RecordSuccessFn;
const isTrippedFuture = isTripped as unknown as IsTrippedFn;
const shouldBypassFuture = shouldBypass as unknown as ShouldBypassFn;

const TRIP_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;
const CIRCUIT_BREAKER_REASON = "circuit_breaker";

function createInitialBreakerState(): FutureBreakerState {
	return { consecutiveFailures: 0, trippedAt: null };
}

function evaluateAutoCompact(
	state: FutureBreakerState,
	now: number,
	opts?: { manual?: boolean },
): { cancel: boolean; reason?: string } {
	if (opts?.manual && shouldBypassFuture(state, { manual: true })) {
		return { cancel: false };
	}
	if (isTrippedFuture(state, now)) {
		return { cancel: true, reason: CIRCUIT_BREAKER_REASON };
	}
	return { cancel: false };
}

const registrations: Array<{ unregister: () => void }> = [];

afterEach(() => {
	vi.useRealTimers();
	for (const registration of registrations.splice(0)) {
		registration.unregister();
	}
});

describe("compaction circuit breaker", () => {
	describe("Given 0 prior failures", () => {
		describe("When the 1st compaction fails", () => {
			it("Then the breaker is not tripped", () => {
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				registration.setResponses([fauxOverflowError("anthropic", "rate_limit_exceeded: first failure")]);

				const initial = createInitialBreakerState();
				const next = recordFailureFuture(initial, 0, { route: "overflow" });

				expect(next.consecutiveFailures).toBe(1);
				expect(next.trippedAt).toBeNull();
				expect(isTrippedFuture(next, 0)).toBe(false);
			});
		});
	});

	describe("Given 2 prior consecutive failures", () => {
		describe("When the 3rd compaction fails", () => {
			it("Then the breaker trips and emits notification", () => {
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				registration.setResponses([
					fauxOverflowError("anthropic", "rate_limit_exceeded: failure 1"),
					fauxOverflowError("anthropic", "rate_limit_exceeded: failure 2"),
					fauxOverflowError("anthropic", "rate_limit_exceeded: failure 3"),
				]);
				const notifications: BreakerNotification[] = [];
				const onTrip = (notification: BreakerNotification): void => {
					notifications.push(notification);
				};

				let state = createInitialBreakerState();
				state = recordFailureFuture(state, 0, { onTrip, route: "overflow" });
				state = recordFailureFuture(state, 1, { onTrip, route: "overflow" });
				expect(isTrippedFuture(state, 1)).toBe(false);
				expect(notifications).toHaveLength(0);

				state = recordFailureFuture(state, 2, { onTrip, route: "overflow" });

				expect(state.consecutiveFailures).toBe(TRIP_THRESHOLD);
				expect(state.trippedAt).toBe(2);
				expect(isTrippedFuture(state, 2)).toBe(true);
				expect(notifications).toHaveLength(1);
				expect(notifications[0].failureCount).toBe(TRIP_THRESHOLD);
				expect(notifications[0].trippedAt).toBe(2);
			});
		});
	});

	describe("Given the breaker is tripped", () => {
		describe("When auto-compact is attempted within 60s", () => {
			it('Then auto-compact returns { cancel: true } with reason "circuit_breaker"', () => {
				const tripped: FutureBreakerState = { consecutiveFailures: TRIP_THRESHOLD, trippedAt: 0 };

				const decision = evaluateAutoCompact(tripped, COOLDOWN_MS / 2);

				expect(decision.cancel).toBe(true);
				expect(decision.reason).toBe(CIRCUIT_BREAKER_REASON);
			});
		});
	});

	describe("Given the breaker is tripped", () => {
		describe("When manual /compact bypasses breaker", () => {
			it("Then the manual route proceeds without circuit_breaker cancellation", () => {
				const tripped: FutureBreakerState = { consecutiveFailures: TRIP_THRESHOLD, trippedAt: 0 };

				const bypassed = shouldBypassFuture(tripped, { manual: true });
				const manualDecision = evaluateAutoCompact(tripped, COOLDOWN_MS / 2, { manual: true });

				expect(bypassed).toBe(true);
				expect(manualDecision.cancel).toBe(false);
				expect(manualDecision.reason).toBeUndefined();
			});
		});
	});

	describe("Given the breaker is tripped at t=0", () => {
		describe("When 59999ms not elapsed", () => {
			it("Then the breaker is still tripped", () => {
				vi.useFakeTimers();
				vi.setSystemTime(0);
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				registration.setResponses([fauxOverflowError("anthropic", "rate_limit_exceeded: cooldown probe")]);
				const tripped: FutureBreakerState = { consecutiveFailures: TRIP_THRESHOLD, trippedAt: 0 };

				vi.advanceTimersByTime(COOLDOWN_MS - 1);
				const stillTripped = isTrippedFuture(tripped, Date.now());
				const decision = evaluateAutoCompact(tripped, Date.now());

				expect(Date.now()).toBe(COOLDOWN_MS - 1);
				expect(stillTripped).toBe(true);
				expect(decision.cancel).toBe(true);
				expect(decision.reason).toBe(CIRCUIT_BREAKER_REASON);
			});
		});

		describe("When 60001ms elapsed", () => {
			it("Then the breaker resets and auto-compact resumes", () => {
				vi.useFakeTimers();
				vi.setSystemTime(0);
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				registration.setResponses([fauxOverflowError("anthropic", "rate_limit_exceeded: cooldown probe")]);
				const tripped: FutureBreakerState = { consecutiveFailures: TRIP_THRESHOLD, trippedAt: 0 };

				vi.advanceTimersByTime(COOLDOWN_MS + 1);
				const reset = isTrippedFuture(tripped, Date.now());
				const decision = evaluateAutoCompact(tripped, Date.now());
				const fresh = recordFailureFuture(tripped, Date.now(), { route: "overflow" });

				expect(Date.now()).toBe(COOLDOWN_MS + 1);
				expect(reset).toBe(false);
				expect(decision.cancel).toBe(false);
				expect(fresh.consecutiveFailures).toBe(1);
			});
		});
	});

	describe("Given the breaker is not tripped", () => {
		describe("When a successful compaction completes", () => {
			it("Then the failure counter resets to 0", () => {
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				const stateWithFailures: FutureBreakerState = { consecutiveFailures: 2, trippedAt: null };

				const after = recordSuccessFuture(stateWithFailures);

				expect(after.consecutiveFailures).toBe(0);
				expect(after.trippedAt).toBeNull();
				expect(isTrippedFuture(after, 0)).toBe(false);
			});
		});
	});

	describe("Given the breaker is tripped", () => {
		describe("When the session reloads", () => {
			it("Then the breaker state is reset (in-memory only, no persistence)", () => {
				const tripped: FutureBreakerState = { consecutiveFailures: TRIP_THRESHOLD, trippedAt: 0 };
				expect(isTrippedFuture(tripped, COOLDOWN_MS / 2)).toBe(true);

				const reloaded = createInitialBreakerState();

				expect(reloaded.consecutiveFailures).toBe(0);
				expect(reloaded.trippedAt).toBeNull();
				expect(isTrippedFuture(reloaded, COOLDOWN_MS / 2)).toBe(false);
				expect(evaluateAutoCompact(reloaded, COOLDOWN_MS / 2).cancel).toBe(false);
			});
		});
	});

	describe("Given 2 fails on overflow route + 1 fail on threshold route", () => {
		describe("When the 3rd failure is recorded", () => {
			it("Then the breaker trips (route-agnostic counter)", () => {
				const registration = registerFauxProvider({ schedulerHook: () => undefined });
				registrations.push(registration);
				registration.setResponses([
					fauxOverflowError("anthropic", "rate_limit_exceeded: overflow route 1"),
					fauxOverflowError("anthropic", "rate_limit_exceeded: overflow route 2"),
					fauxOverflowError("openai", "rate_limit_exceeded: threshold route 3"),
				]);

				let state = createInitialBreakerState();
				state = recordFailureFuture(state, 100, { route: "overflow" });
				state = recordFailureFuture(state, 200, { route: "overflow" });
				state = recordFailureFuture(state, 300, { route: "threshold" });

				expect(state.consecutiveFailures).toBe(TRIP_THRESHOLD);
				expect(state.trippedAt).toBe(300);
				expect(isTrippedFuture(state, 300)).toBe(true);
			});
		});
	});
});
