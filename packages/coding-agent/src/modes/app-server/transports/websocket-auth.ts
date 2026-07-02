import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { dirname } from "node:path";

export type WebSocketListenerAuth =
	| { readonly kind: "off" }
	| { readonly kind: "token-file"; readonly path: string }
	| { readonly kind: "token-value"; readonly token: string };

export type ResolvedWebSocketListenerAuth =
	| { readonly kind: "off" }
	| { readonly kind: "bearer"; readonly token: string; readonly path?: string };

export async function resolveWebSocketListenerAuth(options: {
	readonly auth?: WebSocketListenerAuth;
	readonly stderr: Pick<NodeJS.WriteStream, "write">;
	readonly defaultTokenPath?: string;
	readonly tokenLogLabel: string;
}): Promise<ResolvedWebSocketListenerAuth> {
	const { auth, defaultTokenPath, stderr, tokenLogLabel } = options;
	if (auth?.kind === "off" || (auth === undefined && defaultTokenPath === undefined)) return { kind: "off" };
	if (auth?.kind === "token-value") return { kind: "bearer", token: auth.token };
	const path = auth?.kind === "token-file" ? auth.path : defaultTokenPath;
	if (path === undefined) return { kind: "off" };
	const token = auth?.kind === "token-file" ? await readTokenFile(path) : await ensureTokenFile(path);
	stderr.write(`${tokenLogLabel}: ${path}\n`);
	return { kind: "bearer", token, path };
}

export function isWebSocketRequestAuthorized(request: IncomingMessage, auth: ResolvedWebSocketListenerAuth): boolean {
	if (auth.kind === "off") return true;
	const header = request.headers.authorization;
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
	return tokensEqual(header.slice("Bearer ".length), auth.token);
}

async function readTokenFile(path: string): Promise<string> {
	return (await readFile(path, "utf8")).trim();
}

async function ensureTokenFile(path: string): Promise<string> {
	try {
		return await readTokenFile(path);
	} catch (error: unknown) {
		if (!isNodeErrorCode(error, "ENOENT")) throw error;
	}
	const token = randomBytes(32).toString("hex");
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${token}\n`, { mode: 0o600 });
	await chmod(path, 0o600);
	return token;
}

function tokensEqual(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
