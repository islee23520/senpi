import type { Tool } from "../../../types.ts";
import type { ParserOptions, StreamParser } from "../../types.ts";
import { createInvokeRecoveryStreamParser } from "../anthropic-xml/recovery-stream.ts";
import { antmlInvokeConfig } from "./config.ts";

export function createAntmlInvokeRecoveryStreamParser(tools: readonly Tool[], options?: ParserOptions): StreamParser {
	return createInvokeRecoveryStreamParser(tools, antmlInvokeConfig, options);
}
