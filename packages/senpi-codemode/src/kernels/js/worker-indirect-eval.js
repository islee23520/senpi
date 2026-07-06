export function indirectEval(source, filename) {
	const withPragma = filename ? `${source}\n//# sourceURL=${filename}` : source;
	const geval = globalThis.eval;
	return geval(withPragma);
}

export async function awaitMaybePromise(value) {
	if (!value || typeof value !== "object" || typeof value.then !== "function") return value;
	return await value;
}

export function wrapUserCode(code) {
	const persistentCode = code.replace(/(^|\n)\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gu, "$1globalThis.$2 =");
	if (/\breturn\b/u.test(persistentCode)) return `(async () => {\n${persistentCode}\n})()`;
	return persistentCode;
}
