import { Readable } from "node:stream";
import { attachNdjsonRpcReader } from "../../../src/modes/app-server/rpc/ndjson.ts";

const emissions: unknown[] = [];
const stream = Readable.from(['not-json\n{"id":5,"method":"x"}\n']);

await new Promise<void>((resolve) => {
	attachNdjsonRpcReader(stream, (message) => {
		emissions.push(message);
	});
	stream.on("end", resolve);
});

for (const emission of emissions) {
	console.log(JSON.stringify(emission));
}

if (emissions.length !== 2) {
	throw new Error(`expected 2 emissions, received ${emissions.length}`);
}

const first = JSON.stringify(emissions[0]);
const second = JSON.stringify(emissions[1]);
if (!first.includes("-32700") || !second.includes('"id":5')) {
	throw new Error("malformed-line recovery did not emit parse error then request id 5");
}
