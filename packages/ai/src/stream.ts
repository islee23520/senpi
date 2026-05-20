import "./providers/register-builtins.ts";

import { getApiProvider } from "./api-registry.ts";
import {
	getProtocol,
	getToolCallFormat,
	transformContext,
	wrapStreamWithToolCallMiddleware,
} from "./tool-call-middleware/index.ts";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEventStream,
	Context,
	Model,
	ProviderStreamOptions,
	SimpleStreamOptions,
	StreamOptions,
} from "./types.ts";

export { getEnvApiKey } from "./env-api-keys.ts";

function resolveApiProvider(api: Api) {
	const provider = getApiProvider(api);
	if (!provider) {
		throw new Error(`No API provider registered for api: ${api}`);
	}
	return provider;
}

export function stream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);

	const format = getToolCallFormat(model);
	if (format && context.tools && context.tools.length > 0) {
		const protocol = getProtocol(format);
		const transformedContext = transformContext(context, protocol);
		const innerStream = provider.stream(model, transformedContext, options as StreamOptions);
		return wrapStreamWithToolCallMiddleware(innerStream, protocol, context.tools);
	}

	return provider.stream(model, context, options as StreamOptions);
}

export async function complete<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: ProviderStreamOptions,
): Promise<AssistantMessage> {
	const s = stream(model, context, options);
	return s.result();
}

export function streamSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const provider = resolveApiProvider(model.api);

	const format = getToolCallFormat(model);
	if (format && context.tools && context.tools.length > 0) {
		const protocol = getProtocol(format);
		const transformedContext = transformContext(context, protocol);
		const innerStream = provider.streamSimple(model, transformedContext, options);
		return wrapStreamWithToolCallMiddleware(innerStream, protocol, context.tools);
	}

	return provider.streamSimple(model, context, options);
}

export async function completeSimple<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
): Promise<AssistantMessage> {
	const s = streamSimple(model, context, options);
	return s.result();
}
