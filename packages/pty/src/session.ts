import { Buffer } from "node:buffer";
import process from "node:process";
import { loadNativePty, type NativePtyLoadResult, type NativePtyUnavailableDiagnostic } from "./native-loader.ts";
import {
	type PipeFallbackOperationResult,
	PipeFallbackSession,
	type PipeFallbackSessionExit,
	type PipeFallbackSessionOptions,
	shouldUsePipeFallback,
} from "./pipe-fallback.ts";

export type TerminalSessionBackend = "native" | "pipe-fallback";
export type TerminalSessionDataHandler = (chunk: Buffer) => void;

export interface TerminalSessionOptions {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cols?: number;
	readonly rows?: number;
	readonly timeoutMs?: number;
	readonly rawTailBytes?: number;
}

export interface TerminalSessionNativeOptions {
	readonly command: string;
	readonly args: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cols: number;
	readonly rows: number;
	readonly timeoutMs?: number;
}

export interface TerminalSessionOperationResult {
	readonly ok: boolean;
	readonly note: string;
	readonly code?: string;
	readonly idempotent?: boolean;
}

export interface TerminalSessionExitError {
	readonly code: string;
	readonly message: string;
}

export interface TerminalSessionExit {
	readonly backend: TerminalSessionBackend;
	readonly exitCode: number | null;
	readonly signal: string | null;
	readonly cancelled: boolean;
	readonly timedOut: boolean;
	readonly error?: TerminalSessionExitError;
}

export type TerminalSessionExitState =
	| {
			readonly status: "not_started" | "running";
			readonly exit: null;
	  }
	| {
			readonly status: "exited";
			readonly exit: TerminalSessionExit;
	  };

export interface TerminalSessionHandle {
	readonly onData?: (handler: TerminalSessionDataHandler) => () => void;
	readonly write: (data: string | Uint8Array) => TerminalSessionOperationResult | undefined;
	readonly resize: (cols: number, rows: number) => TerminalSessionOperationResult | undefined;
	readonly kill: (signal?: NodeJS.Signals) => TerminalSessionOperationResult | undefined;
	readonly waitExit?: () => Promise<unknown>;
	readonly wait?: () => Promise<unknown>;
}

export type CreateNativeTerminalSession = (
	options: TerminalSessionNativeOptions,
	onData: TerminalSessionDataHandler,
) => TerminalSessionHandle;

export interface TerminalSessionDependencies {
	readonly nativeLoadResult?: NativePtyLoadResult;
	readonly createNativeSession?: CreateNativeTerminalSession;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

type NativeSessionCreator = (options: TerminalSessionNativeOptions, onData: TerminalSessionDataHandler) => unknown;
type NativeSessionConstructor = new (
	options: TerminalSessionNativeOptions,
	onData: TerminalSessionDataHandler,
) => unknown;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_RAW_TAIL_BYTES = 64 * 1024;

export class TerminalSession {
	readonly options: TerminalSessionOptions;
	private readonly nativeLoadResult: NativePtyLoadResult;
	private readonly createNativeSessionDependency?: CreateNativeTerminalSession;
	private readonly env: Readonly<Record<string, string | undefined>>;
	private readonly rawTailLimit: number;
	private readonly dataHandlers = new Set<TerminalSessionDataHandler>();
	private readonly exitHandlers = new Set<() => void>();
	private backendHandle: TerminalSessionHandle | null = null;
	private backendValue: TerminalSessionBackend | null = null;
	private exitPromise: Promise<TerminalSessionExit> | null = null;
	private settledExit: TerminalSessionExit | null = null;
	private rawTailBuffer = Buffer.alloc(0);
	private rawByteCount = 0;
	private killRequested = false;
	private unsubscribeBackendData: (() => void) | null = null;

	constructor(options: TerminalSessionOptions = {}, dependencies: TerminalSessionDependencies = {}) {
		this.options = {
			...options,
			args: options.args ? [...options.args] : undefined,
			env: options.env ? { ...options.env } : undefined,
		};
		this.nativeLoadResult = dependencies.nativeLoadResult ?? loadNativePty();
		this.createNativeSessionDependency = dependencies.createNativeSession;
		this.env = dependencies.env ?? process.env;
		this.rawTailLimit = normalizeRawTailBytes(options.rawTailBytes);
	}

	get native(): NativePtyLoadResult {
		return this.nativeLoadResult;
	}

	get unavailableDiagnostic(): NativePtyUnavailableDiagnostic | null {
		if (this.nativeLoadResult.native !== null) return null;
		return this.nativeLoadResult.diagnostic;
	}

	get backend(): TerminalSessionBackend | null {
		return this.backendValue;
	}

	get command(): string {
		return this.options.command ?? defaultCommand();
	}

	get status(): "not_started" | "running" | "exited" {
		return this.exitState.status;
	}

	get exited(): boolean {
		return this.settledExit !== null;
	}

	get isExited(): boolean {
		return this.exited;
	}

	get exitResult(): TerminalSessionExit | null {
		return this.settledExit;
	}

	get rawTail(): Buffer {
		return Buffer.from(this.rawTailBuffer);
	}

	get rawOutputBytes(): number {
		return this.rawByteCount;
	}

	get exitState(): TerminalSessionExitState {
		if (this.settledExit !== null) return { status: "exited", exit: this.settledExit };
		return { status: this.backendHandle === null ? "not_started" : "running", exit: null };
	}

	start(): this {
		if (this.settledExit !== null) throw new Error("Cannot restart exited terminal session");
		if (this.backendHandle !== null) throw new Error("Terminal session has already been started");

		const nativeFactory = this.createNativeSessionDependency ?? getNativeSessionFactory(this.nativeLoadResult);
		if (nativeFactory && !shouldUsePipeFallback(this.nativeLoadResult, this.env)) {
			this.backendValue = "native";
			this.backendHandle = nativeFactory(toNativeOptions(this.options), (chunk) => this.emitData(chunk));
		} else {
			this.backendValue = "pipe-fallback";
			const fallback = new PipeFallbackSession(toPipeFallbackOptions(this.options));
			this.backendHandle = fallback;
			this.unsubscribeBackendData = fallback.onData((chunk) => this.emitData(chunk));
			fallback.start();
		}

		if (this.backendValue === "native" && this.backendHandle.onData) {
			this.unsubscribeBackendData = this.backendHandle.onData((chunk) => this.emitData(chunk));
		}
		this.exitPromise = this.waitBackendExit(this.backendHandle, this.backendValue).then((exit) =>
			this.settleExit(exit),
		);
		return this;
	}

	onData(handler: TerminalSessionDataHandler): () => void {
		this.dataHandlers.add(handler);
		return () => this.dataHandlers.delete(handler);
	}

	onExit(handler: () => void): () => void {
		if (this.settledExit !== null) queueMicrotask(handler);
		else this.exitHandlers.add(handler);
		return () => this.exitHandlers.delete(handler);
	}

	write(data: string | Uint8Array): TerminalSessionOperationResult {
		const handle = this.backendHandle;
		if (this.settledExit !== null) return exitedOperation("write");
		if (handle === null) return notStartedOperation("write");
		return normalizeOperationResult(handle.write(data), "Wrote data to terminal session.");
	}

	resize(cols: number, rows: number): TerminalSessionOperationResult {
		const handle = this.backendHandle;
		if (this.settledExit !== null) return exitedOperation("resize");
		if (handle === null) return notStartedOperation("resize");
		return normalizeOperationResult(handle.resize(cols, rows), `Resized terminal session to ${cols}x${rows}.`);
	}

	kill(signal: NodeJS.Signals = "SIGTERM"): TerminalSessionOperationResult {
		const handle = this.backendHandle;
		if (this.killRequested || this.settledExit !== null) {
			return {
				ok: true,
				idempotent: true,
				note: "Terminal session kill was already requested.",
			};
		}
		if (handle === null) return notStartedOperation("kill");

		this.killRequested = true;
		const result = normalizeOperationResult(handle.kill(signal), `Sent ${signal} to terminal session.`);
		if (!result.ok) this.killRequested = false;
		return result;
	}

	stop(): TerminalSessionOperationResult {
		return this.kill();
	}

	async waitExit(): Promise<TerminalSessionExit> {
		if (this.settledExit !== null) return this.settledExit;
		if (this.exitPromise === null) throw new Error("Cannot wait for terminal session exit before start");
		return await this.exitPromise;
	}

	private async waitBackendExit(
		handle: TerminalSessionHandle,
		backend: TerminalSessionBackend,
	): Promise<TerminalSessionExit> {
		const wait = handle.waitExit ?? handle.wait;
		if (!wait) throw new Error("Terminal session backend does not expose waitExit or wait");
		const exit = await wait.call(handle);
		return this.normalizeExit(exit, backend);
	}

	private normalizeExit(exit: unknown, backend: TerminalSessionBackend): TerminalSessionExit {
		if (isRecord(exit) && exit.backend === "pipe-fallback") {
			return normalizePipeFallbackExit(exit as unknown as PipeFallbackSessionExit, this.killRequested);
		}
		if (backend === "pipe-fallback") {
			return normalizePipeFallbackExit(exit as PipeFallbackSessionExit, this.killRequested);
		}
		const record = isRecord(exit) ? exit : {};
		const timedOut = readBoolean(record, "timedOut") ?? readBoolean(record, "timed_out") ?? false;
		return {
			backend,
			exitCode: readNullableNumber(record, "exitCode") ?? readNullableNumber(record, "exit_code") ?? null,
			signal: readNullableString(record, "signal"),
			cancelled:
				(readBoolean(record, "cancelled") ?? readBoolean(record, "canceled") ?? false) ||
				this.killRequested ||
				timedOut,
			timedOut,
			error: readTerminalExitError(record),
		};
	}

	private settleExit(exit: TerminalSessionExit): TerminalSessionExit {
		if (this.settledExit !== null) return this.settledExit;
		this.settledExit = exit;
		this.unsubscribeBackendData?.();
		this.unsubscribeBackendData = null;
		for (const handler of this.exitHandlers) handler();
		this.exitHandlers.clear();
		return exit;
	}

	private emitData(chunk: Buffer | Uint8Array | string): void {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		this.appendRawTail(buffer);
		for (const handler of this.dataHandlers) handler(buffer);
	}

	private appendRawTail(chunk: Buffer): void {
		this.rawByteCount += chunk.byteLength;
		if (this.rawTailLimit === 0) {
			this.rawTailBuffer = Buffer.alloc(0);
			return;
		}
		const next = Buffer.concat([this.rawTailBuffer, chunk]);
		this.rawTailBuffer =
			next.byteLength <= this.rawTailLimit ? next : next.subarray(next.byteLength - this.rawTailLimit);
	}
}

export function createTerminalSession(
	options: TerminalSessionOptions = {},
	dependencies: TerminalSessionDependencies = {},
): TerminalSession {
	return new TerminalSession(options, dependencies).start();
}

function normalizeRawTailBytes(value: number | undefined): number {
	if (value === undefined) return DEFAULT_RAW_TAIL_BYTES;
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error("Invalid rawTailBytes: must be a non-negative safe integer");
	}
	return value;
}

function defaultCommand(): string {
	if (process.platform === "win32") return process.env.ComSpec ?? "cmd.exe";
	return process.env.SHELL ?? "sh";
}

function toNativeOptions(options: TerminalSessionOptions): TerminalSessionNativeOptions {
	return {
		command: options.command ?? defaultCommand(),
		args: [...(options.args ?? [])],
		cwd: options.cwd,
		env: options.env ? { ...options.env } : undefined,
		cols: options.cols ?? DEFAULT_COLS,
		rows: options.rows ?? DEFAULT_ROWS,
		timeoutMs: options.timeoutMs,
	};
}

function toPipeFallbackOptions(options: TerminalSessionOptions): PipeFallbackSessionOptions {
	return {
		command: options.command ?? defaultCommand(),
		args: options.args ? [...options.args] : undefined,
		cwd: options.cwd,
		env: options.env ? { ...options.env } : undefined,
		timeoutMs: options.timeoutMs,
	};
}

function getNativeSessionFactory(loadResult: NativePtyLoadResult): CreateNativeTerminalSession | null {
	if (loadResult.native === null) return null;
	const create = loadResult.native.createPtySession ?? loadResult.native.startPtySession;
	if (isNativeSessionCreator(create)) {
		return (options, onData) => assertTerminalSessionHandle(create(options, onData));
	}
	const PtySession = loadResult.native.PtySession;
	if (isNativeSessionConstructor(PtySession)) {
		return (options, onData) => assertTerminalSessionHandle(new PtySession(options, onData));
	}
	return null;
}

function assertTerminalSessionHandle(value: unknown): TerminalSessionHandle {
	if (!isRecord(value)) throw new Error("Native PTY session factory did not return an object");
	if (typeof value.write !== "function") throw new Error("Native PTY session handle is missing write()");
	if (typeof value.resize !== "function") throw new Error("Native PTY session handle is missing resize()");
	if (typeof value.kill !== "function") throw new Error("Native PTY session handle is missing kill()");
	if (typeof value.waitExit !== "function" && typeof value.wait !== "function") {
		throw new Error("Native PTY session handle is missing waitExit() or wait()");
	}
	return value as unknown as TerminalSessionHandle;
}

function isNativeSessionCreator(value: unknown): value is NativeSessionCreator {
	return typeof value === "function";
}

function isNativeSessionConstructor(value: unknown): value is NativeSessionConstructor {
	return typeof value === "function";
}

function normalizePipeFallbackExit(exit: PipeFallbackSessionExit, killRequested: boolean): TerminalSessionExit {
	return {
		backend: "pipe-fallback",
		exitCode: exit.exitCode,
		signal: exit.signal,
		cancelled: killRequested || exit.timedOut,
		timedOut: exit.timedOut,
		error: exit.error,
	};
}

function normalizeOperationResult(
	result: TerminalSessionOperationResult | PipeFallbackOperationResult | undefined,
	defaultNote: string,
): TerminalSessionOperationResult {
	if (result === undefined) return { ok: true, note: defaultNote };
	if ("ok" in result) return result;
	return { ok: true, note: defaultNote };
}

function notStartedOperation(operation: string): TerminalSessionOperationResult {
	return {
		ok: false,
		code: "not_started",
		note: `Cannot ${operation} terminal session: session has not started.`,
	};
}

function exitedOperation(operation: string): TerminalSessionOperationResult {
	return {
		ok: false,
		code: "exited",
		note: `Cannot ${operation} terminal session: session has exited.`,
	};
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === "object" && value !== null;
}

function readNullableNumber(record: Readonly<Record<string, unknown>>, key: string): number | null | undefined {
	const value = record[key];
	if (value === null) return null;
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNullableString(record: Readonly<Record<string, unknown>>, key: string): string | null {
	const value = record[key];
	if (value === null) return null;
	return typeof value === "string" ? value : null;
}

function readBoolean(record: Readonly<Record<string, unknown>>, key: string): boolean | undefined {
	const value = record[key];
	return typeof value === "boolean" ? value : undefined;
}

function readTerminalExitError(record: Readonly<Record<string, unknown>>): TerminalSessionExitError | undefined {
	const error = record.error;
	if (!isRecord(error)) return undefined;
	const code = typeof error.code === "string" ? error.code : undefined;
	const message = typeof error.message === "string" ? error.message : undefined;
	if (!code || !message) return undefined;
	return { code, message };
}
