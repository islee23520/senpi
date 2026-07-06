import { describe, expect, it } from "vitest";
import { TurnEngineError } from "../../src/modes/app-server/threads/turns.ts";
import { turnStartParams } from "../../src/modes/app-server/turn-adapter.ts";

describe("app-server turn params", () => {
	it("rejects malformed turn/start RPC params before reaching the turn engine", () => {
		const action = () =>
			turnStartParams({ id: 1, method: "turn/start", params: { threadId: "thread-a", input: "hello" } });

		expect(action).toThrow(TurnEngineError);
		expect(action).toThrow("Invalid params: input must be an array");
	});
});
