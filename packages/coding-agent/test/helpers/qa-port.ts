import type { Server } from "node:net";

const QA_PORTS = [18990, 18991, 18992, 18993, 18994, 18995, 18996, 18997, 18998, 18999] as const;

export type QaPort = (typeof QA_PORTS)[number];

export function qaPortsFrom(preferred?: QaPort): readonly QaPort[] {
	if (preferred === undefined) return QA_PORTS;
	return [preferred, ...QA_PORTS.filter((port) => port !== preferred)];
}

export async function listenOnQaPort(server: Server, preferred?: QaPort): Promise<QaPort> {
	const failures: string[] = [];
	for (const port of qaPortsFrom(preferred)) {
		const result = await tryListen(server, port);
		if (result.kind === "listening") return port;
		failures.push(`${port}:${result.message}`);
	}
	throw new Error(`No free QA port in ${QA_PORTS.join(", ")} (${failures.join("; ")})`);
}

async function tryListen(
	server: Server,
	port: QaPort,
): Promise<{ readonly kind: "listening" } | { readonly kind: "failed"; readonly message: string }> {
	return new Promise((resolve) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			resolve({ kind: "failed", message: error.message });
		};
		const onListening = () => {
			server.off("error", onError);
			resolve({ kind: "listening" });
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, "127.0.0.1");
	});
}
