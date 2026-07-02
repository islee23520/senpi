import type { Api, Model } from "@earendil-works/pi-ai/compat";
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import type { AskForApproval } from "../protocol/generated/v2/index.ts";
import { objectValue, optionalString } from "./handler-params.ts";

const DEFAULT_APPROVAL_POLICY: AskForApproval = "never";

type GranularApproval = Extract<AskForApproval, { readonly granular: unknown }>;

export function requestedStartModel(params: Record<string, unknown>): Model<Api> | undefined {
	const model = optionalString(params.model);
	if (!model) {
		return undefined;
	}
	const parsed = parseModelReference(model, optionalString(params.modelProvider));
	if (!parsed) {
		return undefined;
	}
	return findBuiltinModel(parsed.provider, parsed.modelId);
}

export function requestedApprovalPolicy(params: Record<string, unknown>): AskForApproval {
	const value = params.approvalPolicy;
	switch (value) {
		case "untrusted":
		case "on-failure":
		case "on-request":
		case "never":
			return value;
		default:
			return isGranularApproval(value) ? value : DEFAULT_APPROVAL_POLICY;
	}
}

function parseModelReference(
	model: string,
	modelProvider: string | undefined,
): { readonly provider: string; readonly modelId: string } | undefined {
	if (modelProvider) {
		const prefix = `${modelProvider}/`;
		return { provider: modelProvider, modelId: model.startsWith(prefix) ? model.slice(prefix.length) : model };
	}
	const separator = model.indexOf("/");
	if (separator <= 0 || separator >= model.length - 1) {
		return undefined;
	}
	return { provider: model.slice(0, separator), modelId: model.slice(separator + 1) };
}

function isGranularApproval(value: unknown): value is GranularApproval {
	const granular = objectValue(value).granular;
	const object = objectValue(granular);
	return (
		typeof object.sandbox_approval === "boolean" &&
		typeof object.rules === "boolean" &&
		typeof object.skill_approval === "boolean" &&
		typeof object.request_permissions === "boolean" &&
		typeof object.mcp_elicitations === "boolean"
	);
}

function findBuiltinModel(provider: string, modelId: string): Model<Api> | undefined {
	for (const builtinProvider of getBuiltinProviders()) {
		if (builtinProvider === provider) {
			return getBuiltinModels(builtinProvider).find((model) => model.id === modelId);
		}
	}
	return undefined;
}
