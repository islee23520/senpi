import { describe } from "vitest";
import { registerStreamWrapperBasicCases } from "./stream-wrapper-basic-cases.ts";
import {
	registerStreamWrapperErrorCases,
	registerStreamWrapperTransportErrorCase,
} from "./stream-wrapper-error-cases.ts";
import {
	registerStreamWrapperFinalizationCases,
	registerStreamWrapperStopReasonCase,
} from "./stream-wrapper-finalization-cases.ts";

describe("wrapStreamWithToolCallMiddleware", () => {
	registerStreamWrapperBasicCases();
	registerStreamWrapperFinalizationCases();
	registerStreamWrapperErrorCases();
	registerStreamWrapperStopReasonCase();
	registerStreamWrapperTransportErrorCase();
});
