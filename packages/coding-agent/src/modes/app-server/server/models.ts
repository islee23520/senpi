import type { Api, Model as PiModel } from "@earendil-works/pi-ai";
import { AuthStorage } from "../../../core/auth-storage.ts";
import { ModelRegistry } from "../../../core/model-registry.ts";
import { defaultModelPerProvider } from "../../../core/model-resolver.ts";
import { getSupportedThinkingLevels } from "../../../core/thinking-levels.ts";
import type { ModelListParams, ModelListResponse } from "../protocol/generated/v2/index.ts";
import type { Model as WireModel } from "../protocol/generated/v2/Model.ts";
import type { MethodRegistry } from "../rpc/registry.ts";

export interface AppServerModelRegistry {
	getAvailable(): PiModel<Api>[];
}

export interface RegisterAppServerModelMethodsOptions {
	readonly modelRegistry?: AppServerModelRegistry;
}

type InactiveRemoteControlStatusReadResponse = { readonly status: "inactive" };

const DEFAULT_MODEL_IDS = new Map<string, string>(Object.entries(defaultModelPerProvider));

export function registerAppServerModelMethods(
	registry: MethodRegistry,
	options: RegisterAppServerModelMethodsOptions = {},
): void {
	let defaultModelRegistry: AppServerModelRegistry | undefined;
	const getModelRegistry = () => {
		defaultModelRegistry ??= ModelRegistry.create(AuthStorage.create());
		return options.modelRegistry ?? defaultModelRegistry;
	};

	registry.register("model/list", {
		handler: ({ request }) =>
			buildModelListResponse(getModelRegistry().getAvailable(), parseModelListParams(request.params)),
	});
	registry.register("remoteControl/status/read", {
		experimental: true,
		handler: () => buildRemoteControlStatusReadResponse(),
	});
}

export function buildModelListResponse(models: readonly PiModel<Api>[], params: ModelListParams): ModelListResponse {
	const data = models
		.map((model) => buildWireModel(model))
		.filter((model) => params.includeHidden === true || !model.hidden);
	return { data, nextCursor: null };
}

export function buildWireModel(model: PiModel<Api>): WireModel {
	return {
		id: `${model.provider}/${model.id}`,
		model: model.id,
		upgrade: null,
		upgradeInfo: null,
		availabilityNux: null,
		displayName: model.name ?? model.id,
		description: "",
		hidden: false,
		supportedReasoningEfforts: model.reasoning
			? getSupportedThinkingLevels(model)
					.filter((level) => level !== "off")
					.map((reasoningEffort) => ({ reasoningEffort, description: "" }))
			: [],
		defaultReasoningEffort: "medium",
		inputModalities: ["text"],
		supportsPersonality: false,
		additionalSpeedTiers: [],
		serviceTiers: [],
		defaultServiceTier: null,
		isDefault: DEFAULT_MODEL_IDS.get(model.provider) === model.id,
	};
}

function buildRemoteControlStatusReadResponse(): InactiveRemoteControlStatusReadResponse {
	return { status: "inactive" };
}

function parseModelListParams(params: unknown): ModelListParams {
	if (!isRecord(params)) {
		return {};
	}
	return { includeHidden: params.includeHidden === true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
