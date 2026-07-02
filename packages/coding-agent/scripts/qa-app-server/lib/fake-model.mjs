import { createServer } from "node:http";
import { trackCloser, untrackCloser } from "./cleanup.mjs";

export async function startFakeModelServer(turns) {
	const requests = [];
	let callIndex = 0;
	const server = createServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const body = parseJson(Buffer.concat(chunks).toString("utf8"));
			requests.push({
				method: req.method,
				url: req.url,
				authorization: req.headers.authorization ?? null,
				model: body.model,
				messages: body.messages,
			});
			if (req.method === "GET" && (req.url ?? "").includes("/models")) {
				sendJson(res, 200, { object: "list", data: [{ id: "mock-model", object: "model" }] });
				return;
			}
			if (!(req.url ?? "").includes("/chat/completions")) {
				sendJson(res, 404, { error: { message: `no route ${req.method ?? ""} ${req.url ?? ""}` } });
				return;
			}
			const turn = turns[Math.min(callIndex, turns.length - 1)] ?? { text: "OK" };
			callIndex += 1;
			writeCompletionsSse(res, turn, body.model ?? "mock-model");
		});
	});
	await new Promise((resolveListen, rejectListen) => {
		server.once("error", rejectListen);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", rejectListen);
			resolveListen();
		});
	});
	const port = server.address().port;
	const close = () => server.close();
	trackCloser(close);
	return {
		url: `http://127.0.0.1:${port}/v1`,
		requests,
		stop: () =>
			new Promise((resolveStop) => {
				untrackCloser(close);
				server.close(() => resolveStop());
			}),
	};
}

function parseJson(raw) {
	try {
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function sendJson(res, status, obj) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(obj));
}

function writeCompletionsSse(res, turn, modelId) {
	res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
	const base = { id: "chatcmpl-mock", object: "chat.completion.chunk", created: 0, model: modelId };
	const send = (delta, finish = null) => {
		res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
	};
	const complete = () => {
		res.write(`data: ${JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
		res.write("data: [DONE]\n\n");
		res.end();
	};
	send({ role: "assistant", content: "" });
	if (turn.toolCalls?.length) {
		send({
			tool_calls: turn.toolCalls.map((toolCall, index) => ({
				index,
				id: toolCall.id ?? `call_${index + 1}`,
				type: "function",
				function: { name: toolCall.name, arguments: JSON.stringify(toolCall.args ?? {}) },
			})),
		});
		send({}, "tool_calls");
		complete();
		return;
	}
	streamTextChunks(res, send, complete, turn);
}

function streamTextChunks(res, send, complete, turn) {
	const chunks = turn.chunks ?? [turn.text ?? "OK"];
	const delayMs = turn.delayMs ?? 0;
	let index = 0;
	const timer = setInterval(() => {
		if (res.destroyed) {
			clearInterval(timer);
			return;
		}
		if (index < chunks.length) {
			send({ content: chunks[index] });
			index += 1;
			return;
		}
		clearInterval(timer);
		send({}, "stop");
		complete();
	}, Math.max(1, delayMs));
}
