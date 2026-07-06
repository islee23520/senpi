export type TerminalSessionState = "live" | "exited";
export type TerminalSessionSignal = string;
export type MaybePromise<T> = T | Promise<T>;
type ProcessPlatform = string;
type ProcessLike = {
	readonly platform?: string;
	readonly kill?: (target: number, signal?: string) => void;
};

export interface TrackedDetachedChild {
	readonly pid?: number;
	readonly processGroupId?: number;
	readonly exited?: boolean | (() => boolean);
	readonly kill?: (signal?: TerminalSessionSignal) => MaybePromise<unknown>;
}

export interface SessionRegistrySession {
	readonly command?: string;
	readonly exited?: boolean;
	readonly isExited?: boolean | (() => boolean);
	readonly exitResult?: unknown;
	readonly exitState?: { readonly status?: string };
	readonly status?: string;
	readonly trackedDetachedChildren?: readonly TrackedDetachedChild[];
	readonly getTrackedDetachedChildren?: () => readonly TrackedDetachedChild[];
	readonly onExit?: (handler: () => void) => (() => void) | undefined;
	readonly stop?: () => MaybePromise<unknown>;
	readonly kill?: (signal?: TerminalSessionSignal) => MaybePromise<unknown>;
	readonly signal?: (signal: TerminalSessionSignal) => MaybePromise<unknown>;
}

export interface SessionRegistryCreateOptions<TSession extends SessionRegistrySession = SessionRegistrySession> {
	readonly command?: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cols?: number;
	readonly rows?: number;
	readonly session?: TSession;
}

export interface SessionRegistryCreateContext {
	readonly id: string;
	readonly command: string;
	readonly args?: readonly string[];
	readonly cwd?: string;
	readonly env?: Readonly<Record<string, string | undefined>>;
	readonly cols?: number;
	readonly rows?: number;
}

export interface InitialSessionRegistryEntry<TSession extends SessionRegistrySession = SessionRegistrySession> {
	readonly id: string;
	readonly session: TSession;
	readonly command?: string;
}

export interface SessionRegistryEntry<TSession extends SessionRegistrySession = SessionRegistrySession> {
	readonly id: string;
	readonly command: string;
	readonly session: TSession;
	readonly createdAt: number;
	readonly lastUsedAt: number;
	readonly state: TerminalSessionState;
	readonly exitedAt: number | null;
}

export interface SessionRegistrySweepOptions {
	readonly remove?: boolean;
}

export interface SessionRegistryOptions<TSession extends SessionRegistrySession = SessionRegistrySession> {
	readonly maxSessions?: number;
	readonly initialSessions?: readonly InitialSessionRegistryEntry<TSession>[];
	readonly createSession?: (options: SessionRegistryCreateContext) => MaybePromise<TSession>;
	readonly killProcess?: (target: number, signal: TerminalSessionSignal) => void;
	readonly now?: () => number;
	readonly platform?: ProcessPlatform;
}

type StoredSessionRegistryEntry<TSession extends SessionRegistrySession> = {
	id: string;
	command: string;
	session: TSession;
	createdAt: number;
	lastUsedAt: number;
	state: TerminalSessionState;
	exitedAt: number | null;
	unsubscribeExit: (() => void) | null;
	stopPromise: Promise<boolean> | null;
	detachedCleanupPromise: Promise<void> | null;
};

const DEFAULT_MAX_SESSIONS = 32;
const DEFAULT_COMMAND = "bash";
const DEFAULT_SIGNAL: TerminalSessionSignal = "SIGTERM";

export class SessionRegistryCapacityError extends Error {
	readonly code = "session_registry_capacity";
	readonly maxSessions: number;

	constructor(maxSessions: number) {
		super(`Cannot create terminal session: all ${maxSessions} registry slots are live.`);
		this.name = "SessionRegistryCapacityError";
		this.maxSessions = maxSessions;
	}
}

export class SessionRegistry<TSession extends SessionRegistrySession = SessionRegistrySession> {
	private readonly entries = new Map<string, StoredSessionRegistryEntry<TSession>>();
	private readonly idCounters = new Map<string, number>();
	private readonly createSession: ((options: SessionRegistryCreateContext) => MaybePromise<TSession>) | null;
	private readonly killProcess: (target: number, signal: TerminalSessionSignal) => void;
	private readonly now: () => number;
	private readonly platform: ProcessPlatform;
	private sequence = 0;
	readonly maxSessions: number;

	constructor(options: SessionRegistryOptions<TSession> = {}) {
		this.maxSessions = normalizeMaxSessions(options.maxSessions);
		this.createSession = options.createSession ?? null;
		this.killProcess = options.killProcess ?? defaultKillProcess;
		this.now = options.now ?? Date.now;
		this.platform = options.platform ?? getRuntimeProcess().platform ?? "unknown";

		for (const initial of options.initialSessions ?? []) {
			this.addEntry(initial.id, initial.session, initial.command ?? initial.session.command ?? DEFAULT_COMMAND);
		}
		void this.sweepExited();
	}

	get size(): number {
		return this.entries.size;
	}

	list(): readonly SessionRegistryEntry<TSession>[] {
		this.refreshExitedStates();
		return [...this.entries.values()].sort((left, right) => left.createdAt - right.createdAt);
	}

	get(id: string): SessionRegistryEntry<TSession> | null {
		const entry = this.entries.get(id);
		if (!entry) return null;
		entry.lastUsedAt = this.timestamp();
		this.refreshEntryState(entry);
		return entry;
	}

	async create(options: SessionRegistryCreateOptions<TSession> = {}): Promise<SessionRegistryEntry<TSession>> {
		await this.enforceCapacityForCreate();
		const command = options.command ?? options.session?.command ?? DEFAULT_COMMAND;
		const id = this.allocateId(command);
		const session =
			options.session ??
			(await this.createSessionWithFactory({
				id,
				command,
				args: options.args,
				cwd: options.cwd,
				env: options.env,
				cols: options.cols,
				rows: options.rows,
			}));
		return this.addEntry(id, session, command);
	}

	async sweepExited(options: SessionRegistrySweepOptions = {}): Promise<readonly string[]> {
		this.refreshExitedStates();
		const sweptIds: string[] = [];
		for (const entry of this.entries.values()) {
			if (entry.state !== "exited") continue;
			await this.cleanupDetachedChildren(entry);
			sweptIds.push(entry.id);
			if (options.remove) this.removeEntry(entry.id);
		}
		return sweptIds;
	}

	async stop(id: string): Promise<boolean> {
		const entry = this.entries.get(id);
		if (!entry) return false;
		if (entry.stopPromise) return entry.stopPromise;
		entry.stopPromise = this.stopEntry(entry);
		return entry.stopPromise;
	}

	async stopAll(): Promise<void> {
		await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
	}

	async teardown(): Promise<void> {
		await this.stopAll();
		for (const id of [...this.entries.keys()]) this.removeEntry(id);
	}

	private async createSessionWithFactory(options: SessionRegistryCreateContext): Promise<TSession> {
		if (!this.createSession) {
			throw new Error("Cannot create terminal session: SessionRegistry requires a createSession factory.");
		}
		return this.createSession(options);
	}

	private addEntry(id: string, session: TSession, command: string): SessionRegistryEntry<TSession> {
		const timestamp = this.timestamp();
		const exited = isTerminalSessionExited(session);
		const entry: StoredSessionRegistryEntry<TSession> = {
			id,
			command,
			session,
			createdAt: timestamp,
			lastUsedAt: timestamp,
			state: exited ? "exited" : "live",
			exitedAt: exited ? timestamp : null,
			unsubscribeExit: null,
			stopPromise: null,
			detachedCleanupPromise: null,
		};
		entry.unsubscribeExit =
			session.onExit?.(() => {
				void this.handleSessionExit(id);
			}) ?? null;
		this.entries.set(id, entry);
		this.observeId(id);
		return entry;
	}

	private async handleSessionExit(id: string): Promise<void> {
		const entry = this.entries.get(id);
		if (!entry) return;
		this.markExited(entry);
		await this.cleanupDetachedChildren(entry);
	}

	private async enforceCapacityForCreate(): Promise<void> {
		this.refreshExitedStates();
		await this.pruneExitedUntilAtMost(this.maxSessions - 1);
		if (this.entries.size >= this.maxSessions) throw new SessionRegistryCapacityError(this.maxSessions);
	}

	private async pruneExitedUntilAtMost(maxSize: number): Promise<void> {
		while (this.entries.size > maxSize) {
			const entry = this.findLeastRecentlyUsedExited();
			if (!entry) return;
			await this.cleanupDetachedChildren(entry);
			this.removeEntry(entry.id);
		}
	}

	private findLeastRecentlyUsedExited(): StoredSessionRegistryEntry<TSession> | null {
		let selected: StoredSessionRegistryEntry<TSession> | null = null;
		for (const entry of this.entries.values()) {
			if (entry.state !== "exited") continue;
			if (!selected || entry.lastUsedAt < selected.lastUsedAt) selected = entry;
			else if (selected.lastUsedAt === entry.lastUsedAt && entry.createdAt < selected.createdAt) selected = entry;
		}
		return selected;
	}

	private async stopEntry(entry: StoredSessionRegistryEntry<TSession>): Promise<boolean> {
		this.refreshEntryState(entry);
		await this.cleanupDetachedChildren(entry);
		if (entry.state !== "exited") {
			await stopTerminalSession(entry.session);
			this.markExited(entry);
		}
		return true;
	}

	private async cleanupDetachedChildren(entry: StoredSessionRegistryEntry<TSession>): Promise<void> {
		if (entry.detachedCleanupPromise) return entry.detachedCleanupPromise;
		entry.detachedCleanupPromise = this.cleanupDetachedChildrenOnce(entry.session);
		return entry.detachedCleanupPromise;
	}

	private async cleanupDetachedChildrenOnce(session: TSession): Promise<void> {
		for (const child of getTrackedDetachedChildren(session)) {
			if (isTrackedDetachedChildExited(child)) continue;
			if (child.kill) {
				await child.kill(DEFAULT_SIGNAL);
				continue;
			}
			const target = getDetachedChildKillTarget(child, this.platform);
			if (target === null) continue;
			try {
				this.killProcess(target, DEFAULT_SIGNAL);
			} catch (error) {
				if (!isMissingProcessError(error)) throw error;
			}
		}
	}

	private refreshExitedStates(): void {
		for (const entry of this.entries.values()) this.refreshEntryState(entry);
	}

	private refreshEntryState(entry: StoredSessionRegistryEntry<TSession>): void {
		if (entry.state === "exited") return;
		if (isTerminalSessionExited(entry.session)) this.markExited(entry);
	}

	private markExited(entry: StoredSessionRegistryEntry<TSession>): void {
		if (entry.state === "exited") return;
		entry.state = "exited";
		entry.exitedAt = this.timestamp();
	}

	private removeEntry(id: string): void {
		const entry = this.entries.get(id);
		if (!entry) return;
		entry.unsubscribeExit?.();
		this.entries.delete(id);
	}

	private allocateId(command: string): string {
		const prefix = sessionIdPrefix(command);
		let next = (this.idCounters.get(prefix) ?? 0) + 1;
		while (this.entries.has(`${prefix}_${next}`)) next += 1;
		this.idCounters.set(prefix, next);
		return `${prefix}_${next}`;
	}

	private observeId(id: string): void {
		const match = /^(.*)_(\d+)$/.exec(id);
		if (!match) return;
		const prefix = match[1];
		const value = Number.parseInt(match[2] ?? "", 10);
		if (!prefix || !Number.isFinite(value)) return;
		this.idCounters.set(prefix, Math.max(this.idCounters.get(prefix) ?? 0, value));
	}

	private timestamp(): number {
		this.sequence += 1;
		return this.now() * 1000 + this.sequence;
	}
}

export function sessionIdPrefix(command: string): string {
	const parts = command.split(/[\\/]/).filter(Boolean);
	const baseName = parts[parts.length - 1] ?? DEFAULT_COMMAND;
	const prefix = baseName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
	return prefix || "session";
}

export function isTerminalSessionExited(session: SessionRegistrySession): boolean {
	if (session.exited === true) return true;
	if (typeof session.isExited === "boolean") return session.isExited;
	if (typeof session.isExited === "function" && session.isExited()) return true;
	if (session.exitState?.status === "exited") return true;
	if (session.status === "exited" || session.status === "closed" || session.status === "stopped") return true;
	return session.exitResult !== undefined && session.exitResult !== null;
}

function normalizeMaxSessions(value: number | undefined): number {
	if (value === undefined) return DEFAULT_MAX_SESSIONS;
	if (!Number.isFinite(value) || value < 1) throw new Error("maxSessions must be a positive finite number.");
	return Math.trunc(value);
}

async function stopTerminalSession(session: SessionRegistrySession): Promise<void> {
	if (session.stop) {
		await session.stop();
		return;
	}
	if (session.kill) {
		await session.kill(DEFAULT_SIGNAL);
		return;
	}
	if (session.signal) await session.signal(DEFAULT_SIGNAL);
}

function getTrackedDetachedChildren(session: SessionRegistrySession): readonly TrackedDetachedChild[] {
	return session.getTrackedDetachedChildren?.() ?? session.trackedDetachedChildren ?? [];
}

function isTrackedDetachedChildExited(child: TrackedDetachedChild): boolean {
	if (typeof child.exited === "boolean") return child.exited;
	if (typeof child.exited === "function") return child.exited();
	return false;
}

function getDetachedChildKillTarget(child: TrackedDetachedChild, platform: ProcessPlatform): number | null {
	if (platform !== "win32" && isPositiveInteger(child.processGroupId)) return -child.processGroupId;
	if (isPositiveInteger(child.pid)) return child.pid;
	return null;
}

function isPositiveInteger(value: number | undefined): value is number {
	return value !== undefined && Number.isInteger(value) && value > 0;
}

function defaultKillProcess(target: number, signal: TerminalSessionSignal): void {
	const kill = getRuntimeProcess().kill;
	if (!kill) throw new Error("Cannot kill detached child: runtime process.kill is unavailable.");
	kill(target, signal);
}

function isMissingProcessError(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const code = (error as { readonly code?: unknown }).code;
	return code === "ESRCH";
}

function getRuntimeProcess(): ProcessLike {
	if (!("process" in globalThis)) return {};
	const candidate = (globalThis as { readonly process?: unknown }).process;
	if (typeof candidate !== "object" || candidate === null) return {};
	return candidate as ProcessLike;
}
