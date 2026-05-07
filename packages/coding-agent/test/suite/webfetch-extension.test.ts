import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Static } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import webfetchExtension, { isWebfetchEnabled } from "../../src/core/extensions/builtin/webfetch/index.js";
import { webfetch } from "../../src/core/extensions/builtin/webfetch/tool.js";
import type { ExtensionAPI } from "../../src/core/extensions/types.js";

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void;

const servers: Server[] = [];
const ENABLE_ENV = "PI_WEBFETCH";

async function createFixtureServer(handler: RouteHandler): Promise<{ baseUrl: string; server: Server }> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		throw new Error("Expected TCP server address");
	}
	servers.push(server);
	return { baseUrl: `http://127.0.0.1:${address.port}`, server };
}

type WebfetchParams = Static<typeof webfetch.parameters>;

async function executeWebfetch(params: WebfetchParams): Promise<Awaited<ReturnType<typeof webfetch.execute>>> {
	return webfetch.execute("tool", params, undefined, undefined, undefined as never);
}

function textContent(result: Awaited<ReturnType<typeof executeWebfetch>>): string {
	const first = result.content[0];
	if (!first || first.type !== "text") {
		throw new Error("Expected text content");
	}
	return first.text;
}

afterEach(async () => {
	delete process.env[ENABLE_ENV];
	await Promise.all(servers.splice(0).map(closeServer));
});

function closeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function waitUntil(assertion: () => void): Promise<void> {
	const deadline = Date.now() + 500;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			assertion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	}
	if (lastError instanceof Error) throw lastError;
}

describe("webfetch builtin extension", () => {
	it("#given webfetch tool #when inspecting metadata #then exposes expected name and schema", () => {
		expect(webfetch.name).toBe("webfetch");
		expect(webfetch.label).toBe("Web Fetch");
		expect(webfetch.description).toContain("Fetches content from a URL");
		expect(webfetch.parameters.required).toEqual(["url"]);
		expect(webfetch.parameters.properties).toHaveProperty("url");
		expect(webfetch.parameters.properties).toHaveProperty("format");
		expect(webfetch.parameters.properties).toHaveProperty("timeout");
	});

	it("#given html page #when fetching markdown #then returns converted markdown", async () => {
		const server = await createFixtureServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			response.end(
				"<html><body><h1>Hello Web</h1><p>Alpha <strong>Beta</strong></p><script>bad()</script></body></html>",
			);
		});

		const result = await executeWebfetch({ url: `${server.baseUrl}/page`, format: "markdown" });

		expect(textContent(result)).toContain("# Hello Web");
		expect(textContent(result)).toContain("Alpha **Beta**");
		expect(textContent(result)).not.toContain("bad()");
		expect(result.details?.format).toBe("markdown");
		expect(result.details?.status).toBe(200);
	});

	it("#given html page #when fetching text #then returns readable text without tags", async () => {
		const server = await createFixtureServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html" });
			response.end("<main><h1>Title</h1><p>One&nbsp;Two</p><style>.x{}</style></main>");
		});

		const result = await executeWebfetch({ url: `${server.baseUrl}/text`, format: "text" });

		expect(textContent(result)).toContain("Title");
		expect(textContent(result)).toContain("One Two");
		expect(textContent(result)).not.toContain("<h1>");
		expect(result.details?.format).toBe("text");
	});

	it("#given html page #when fetching html #then returns raw html", async () => {
		const html = "<h1>Raw</h1><p>HTML</p>";
		const server = await createFixtureServer((_request, response) => {
			response.writeHead(200, { "content-type": "text/html" });
			response.end(html);
		});

		const result = await executeWebfetch({ url: `${server.baseUrl}/raw`, format: "html" });

		expect(textContent(result)).toBe(html);
		expect(result.details?.contentType).toContain("text/html");
	});

	it("#given invalid scheme #when fetching #then rejects before network access", async () => {
		await expect(executeWebfetch({ url: "file:///tmp/secret", format: "markdown" })).rejects.toThrow(
			"URL must start with http:// or https://",
		);
	});

	it("#given oversized content length #when fetching #then rejects and closes the response", async () => {
		let connectionClosed = false;
		const server = await createFixtureServer((_request, response) => {
			response.writeHead(200, { "content-length": String(6 * 1024 * 1024), "content-type": "text/plain" });
			response.write("oversized");
			response.on("close", () => {
				connectionClosed = true;
			});
		});

		await expect(executeWebfetch({ url: `${server.baseUrl}/large`, format: "text" })).rejects.toThrow(
			"Response too large (exceeds 5MB limit)",
		);
		await waitUntil(() => expect(connectionClosed).toBe(true));
	});

	it("#given Cloudflare challenge #when retrying #then closes the challenged response", async () => {
		let challengeClosed = false;
		let requests = 0;
		const server = await createFixtureServer((_request, response) => {
			requests += 1;
			if (requests === 1) {
				response.writeHead(403, { "cf-mitigated": "challenge", "content-type": "text/html" });
				response.write("<h1>challenge</h1>");
				response.on("close", () => {
					challengeClosed = true;
				});
				return;
			}

			response.writeHead(200, { "content-type": "text/plain" });
			response.end("retried");
		});

		const result = await executeWebfetch({ url: `${server.baseUrl}/challenge`, format: "text" });

		expect(textContent(result)).toBe("retried");
		expect(requests).toBe(2);
		expect(challengeClosed).toBe(true);
	});
});

describe("webfetch builtin extension toggle", () => {
	it("returns true when PI_WEBFETCH is unset", () => {
		expect(isWebfetchEnabled()).toBe(true);
	});

	it.each(["1", "true", "yes", "on", " TRUE ", "\tYeS\n"])(
		"returns true for truthy PI_WEBFETCH value %s",
		(envValue) => {
			process.env[ENABLE_ENV] = envValue;
			expect(isWebfetchEnabled()).toBe(true);
		},
	);

	it.each(["0", "false", "no", "off", " OFF ", "\nNo\t"])(
		"returns false for falsy PI_WEBFETCH value %s",
		(envValue) => {
			process.env[ENABLE_ENV] = envValue;
			expect(isWebfetchEnabled()).toBe(false);
		},
	);

	it("returns true for unknown PI_WEBFETCH values", () => {
		process.env[ENABLE_ENV] = "definitely";
		expect(isWebfetchEnabled()).toBe(true);
	});

	it("is a no-op when PI_WEBFETCH is disabled", () => {
		process.env[ENABLE_ENV] = "0";
		const registerTool = vi.fn();
		webfetchExtension({ registerTool } as unknown as ExtensionAPI);
		expect(registerTool).not.toHaveBeenCalled();
	});

	it("registers the webfetch tool when PI_WEBFETCH is unset", () => {
		const registerTool = vi.fn();
		webfetchExtension({ registerTool } as unknown as ExtensionAPI);
		expect(registerTool).toHaveBeenCalledTimes(1);
	});
});
