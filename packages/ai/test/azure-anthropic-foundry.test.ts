import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { streamSimple } from "../src/compat.ts";
import { createModels } from "../src/models.ts";
import { builtinProviders } from "../src/providers/all.ts";
import type { Model, SimpleStreamOptions } from "../src/types.ts";

interface CachePayload {
	system?: { type: string; cache_control?: { type: string; ttl?: string } }[];
	tools?: { name: string; cache_control?: { type: string; ttl?: string } }[];
	messages?: { role: string; content: { type: string; cache_control?: { type: string; ttl?: string } }[] }[];
}

class PayloadCaptured extends Error {
	constructor() {
		super("payload captured");
		this.name = "PayloadCaptured";
	}
}

function foundryModel(): Model<"anthropic-messages"> {
	const model = models().getModel("azure-anthropic-foundry", "claude-opus-4-8") as Model<"anthropic-messages">;
	// Unroutable endpoint: the payload is captured before the request leaves.
	return { ...model, baseUrl: "http://127.0.0.1:9" };
}

async function capturePayload(options?: SimpleStreamOptions): Promise<CachePayload> {
	let captured: CachePayload | undefined;
	const s = streamSimple(
		foundryModel(),
		{
			systemPrompt: "You are a helpful assistant.",
			messages: [{ role: "user", content: "Hello", timestamp: Date.now() }],
			tools: [{ name: "read", description: "Read a file", parameters: { type: "object", properties: {} } }],
		},
		{
			...options,
			apiKey: "fake-key",
			onPayload: (payload) => {
				captured = payload as CachePayload;
				throw new PayloadCaptured();
			},
		},
	);
	await s.result();
	if (!captured) throw new Error("Expected payload to be captured before request failure");
	return captured;
}

const ENV_KEYS = ["ANTHROPIC_FOUNDRY_API_KEY", "ANTHROPIC_FOUNDRY_BASE_URL", "ANTHROPIC_FOUNDRY_RESOURCE"] as const;
const original = new Map<string, string | undefined>();

function models() {
	const registry = createModels();
	for (const provider of builtinProviders()) registry.setProvider(provider);
	return registry;
}

beforeEach(() => {
	for (const key of ENV_KEYS) {
		original.set(key, process.env[key]);
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const value = original.get(key);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}
});

describe("azure-anthropic-foundry", () => {
	it("registers the provider with anthropic-messages models", () => {
		const provider = models().getProvider("azure-anthropic-foundry");
		expect(provider).toBeDefined();
		const catalog = provider?.getModels() ?? [];
		expect(catalog.length).toBeGreaterThan(0);
		for (const model of catalog) {
			expect(model.api).toBe("anthropic-messages");
			expect(model.provider).toBe("azure-anthropic-foundry");
		}
	});

	it("derives the base URL from the resource name", async () => {
		process.env.ANTHROPIC_FOUNDRY_API_KEY = "test-key";
		process.env.ANTHROPIC_FOUNDRY_RESOURCE = "my-resource";

		const auth = await models().getAuth("azure-anthropic-foundry");

		expect(auth?.auth.baseUrl).toBe("https://my-resource.services.ai.azure.com/anthropic/");
		expect(auth?.source).toBe("ANTHROPIC_FOUNDRY_API_KEY");
		// Model refreshes list deployments from this env value; a resource name alone must still reach it.
		expect(auth?.env?.ANTHROPIC_FOUNDRY_BASE_URL).toBe("https://my-resource.services.ai.azure.com/anthropic/");
	});

	it("prefers an explicit base URL and normalizes the trailing slash", async () => {
		process.env.ANTHROPIC_FOUNDRY_API_KEY = "test-key";
		process.env.ANTHROPIC_FOUNDRY_RESOURCE = "my-resource";
		process.env.ANTHROPIC_FOUNDRY_BASE_URL = "https://custom.example.com/anthropic";

		const auth = await models().getAuth("azure-anthropic-foundry");

		expect(auth?.auth.baseUrl).toBe("https://custom.example.com/anthropic/");
	});

	// Azure gateways authenticate with `api-key`; the Anthropic SDK only sends `x-api-key`.
	it("mirrors the key into an api-key header", async () => {
		process.env.ANTHROPIC_FOUNDRY_API_KEY = "test-key";
		process.env.ANTHROPIC_FOUNDRY_RESOURCE = "my-resource";

		const auth = await models().getAuth("azure-anthropic-foundry");

		expect(auth?.auth.apiKey).toBe("test-key");
		expect(auth?.auth.headers).toMatchObject({ "api-key": "test-key" });
	});

	it("is unconfigured without an api key", async () => {
		process.env.ANTHROPIC_FOUNDRY_RESOURCE = "my-resource";

		expect(await models().getAuth("azure-anthropic-foundry")).toBeUndefined();
	});

	it("rejects when no endpoint is configured", async () => {
		process.env.ANTHROPIC_FOUNDRY_API_KEY = "test-key";

		await expect(models().getAuth("azure-anthropic-foundry")).rejects.toThrow(
			/ANTHROPIC_FOUNDRY_RESOURCE or ANTHROPIC_FOUNDRY_BASE_URL/,
		);
	});

	// getAvailable() checks every provider together; a Foundry key without an endpoint
	// must not reject the whole listing, only requests to this provider.
	it("lists models when the key is set but the endpoint is not", async () => {
		process.env.ANTHROPIC_FOUNDRY_API_KEY = "test-key";

		const available = await models().getAvailable();

		expect(available.some((model) => model.provider === "azure-anthropic-foundry")).toBe(true);
	});

	// Prompt caching is what makes this provider affordable; the mirrored catalog must
	// carry the same cache metadata as native Anthropic or every request is billed full price.
	it("mirrors prompt cache lifetimes and cache pricing from Anthropic", () => {
		const registry = models();
		const native = registry.getModel("anthropic", "claude-opus-4-8");
		const foundry = registry.getModel("azure-anthropic-foundry", "claude-opus-4-8");
		if (!native || !foundry) throw new Error("Expected both Anthropic catalogs to expose claude-opus-4-8");

		expect(foundry.promptCache).toEqual(native.promptCache);
		expect(foundry.promptCache?.short).toBeGreaterThan(0);
		expect(foundry.cost.cacheRead).toBe(native.cost.cacheRead);
		expect(foundry.cost.cacheWrite).toBe(native.cost.cacheWrite);
		expect(foundry.cost.cacheRead).toBeGreaterThan(0);
	});

	// Anthropic may answer with an allowed fallback model; its price is looked up by provider,
	// so mirrored fallbacks must name this provider or the response is billed at the wrong rate.
	it("points mirrored fallback models at the Foundry provider", () => {
		const fallbacks = models()
			.getProvider("azure-anthropic-foundry")
			?.getModels()
			.flatMap((model) => (model as Model<"anthropic-messages">).compat?.allowedFallbackModels ?? []);

		expect(fallbacks?.length).toBeGreaterThan(0);
		for (const fallback of fallbacks ?? []) expect(fallback.provider).toBe("azure-anthropic-foundry");
	});

	it("sets cache breakpoints on system, tools, and conversation", async () => {
		const payload = await capturePayload({ cacheRetention: "short" });

		expect(payload.system?.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
		// The tool breakpoint sits on the last initial tool, which a deferred placeholder follows.
		expect(payload.tools?.filter((tool) => tool.cache_control)).toEqual([
			expect.objectContaining({ cache_control: { type: "ephemeral" } }),
		]);
		expect(payload.messages?.at(-1)?.content.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
	});

	it("applies the 1h ttl for long cache retention", async () => {
		const payload = await capturePayload({ cacheRetention: "long" });

		expect(payload.system?.at(-1)?.cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
	});

	it("omits cache breakpoints when caching is disabled", async () => {
		const payload = await capturePayload({ cacheRetention: "none" });

		expect(payload.system?.at(-1)?.cache_control).toBeUndefined();
		expect(payload.tools?.every((tool) => tool.cache_control === undefined)).toBe(true);
		expect(payload.messages?.at(-1)?.content.at(-1)?.cache_control).toBeUndefined();
	});
});
