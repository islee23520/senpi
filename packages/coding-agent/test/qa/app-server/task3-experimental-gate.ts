import { createRegistry } from "../../../src/modes/app-server/rpc/registry.ts";

const registry = createRegistry();
registry.register("exp/m", {
	experimental: true,
	handler: async () => ({ ok: true }),
});

const response = await registry.dispatch(
	{ initialized: true, capabilities: { experimentalApi: false } },
	{ id: 1, method: "exp/m" },
);

if (!("error" in response)) {
	throw new Error("expected experimental request to be rejected");
}

console.log(response.error.message);
