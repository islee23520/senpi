import {
	alreadyInitializedError,
	experimentalCapabilityError,
	internalError,
	type JsonRpcError,
	methodNotFoundError,
	notInitializedError,
} from "./errors.ts";

export type RequestId = string | number | null;

export interface RpcRequest {
	readonly id: RequestId;
	readonly method: string;
	readonly params?: unknown;
}

export type RpcResponse =
	| { readonly id: RequestId; readonly result: unknown }
	| { readonly id: RequestId; readonly error: JsonRpcError };

export interface ConnectionCapabilities {
	readonly experimentalApi?: boolean;
}

export interface RegistryConnection {
	readonly initialized: boolean;
	readonly capabilities?: ConnectionCapabilities;
}

export type MethodScope = "thread" | "global" | "none";

export interface MethodHandlerContext {
	readonly connection: RegistryConnection;
	readonly request: RpcRequest;
}

export type MethodHandler = (context: MethodHandlerContext) => Promise<unknown> | unknown;

export interface MethodRegistration {
	readonly handler: MethodHandler;
	readonly experimental?: boolean;
	readonly requiresInit?: boolean;
	readonly scope?: MethodScope;
}

export interface MethodRegistry {
	register(method: string, registration: MethodRegistration): void;
	dispatch(connection: RegistryConnection, request: RpcRequest): Promise<RpcResponse>;
}

export function createRegistry(): MethodRegistry {
	return new InMemoryMethodRegistry();
}

class InMemoryMethodRegistry implements MethodRegistry {
	private readonly methods = new Map<string, MethodRegistration>();

	register(method: string, registration: MethodRegistration): void {
		this.methods.set(method, registration);
	}

	async dispatch(connection: RegistryConnection, request: RpcRequest): Promise<RpcResponse> {
		if (!connection.initialized) {
			const registration = this.methods.get(request.method);
			if (request.method !== "initialize" || registration?.requiresInit !== false) {
				return { id: request.id, error: notInitializedError() };
			}
		}

		if (connection.initialized && request.method === "initialize") {
			return { id: request.id, error: alreadyInitializedError() };
		}

		const registration = this.methods.get(request.method);
		if (!registration) {
			return { id: request.id, error: methodNotFoundError(request.method) };
		}

		if (registration.experimental === true && connection.capabilities?.experimentalApi !== true) {
			return { id: request.id, error: experimentalCapabilityError(request.method) };
		}

		try {
			const result = await registration.handler({ connection, request });
			return { id: request.id, result };
		} catch (error) {
			return { id: request.id, error: internalError(error instanceof Error ? error.message : String(error)) };
		}
	}
}
