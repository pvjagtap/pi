import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stream } from "../src/api/openai-completions.ts";
import { createModels } from "../src/models.ts";
import { builtinProviders } from "../src/providers/all.ts";
import type { Model } from "../src/types.ts";

const ENV_KEYS = ["KIMI_FOUNDRY_API_KEY", "KIMI_FOUNDRY_BASE_URL", "KIMI_FOUNDRY_RESOURCE"] as const;
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

describe("azure-moonshotai-foundry", () => {
	it("registers the provider with openai-completions models", () => {
		const provider = models().getProvider("azure-moonshotai-foundry");
		expect(provider).toBeDefined();
		const catalog = provider?.getModels() ?? [];
		expect(catalog.length).toBeGreaterThan(0);
		for (const model of catalog) {
			expect(model.api).toBe("openai-completions");
			expect(model.provider).toBe("azure-moonshotai-foundry");
		}
	});

	it("derives the base URL from the resource name", async () => {
		process.env.KIMI_FOUNDRY_API_KEY = "test-key";
		process.env.KIMI_FOUNDRY_RESOURCE = "my-resource";

		const auth = await models().getAuth("azure-moonshotai-foundry");

		expect(auth?.auth.baseUrl).toBe("https://my-resource.services.ai.azure.com/openai/v1/");
		expect(auth?.source).toBe("KIMI_FOUNDRY_API_KEY");
	});

	it("prefers an explicit base URL verbatim", async () => {
		process.env.KIMI_FOUNDRY_API_KEY = "test-key";
		process.env.KIMI_FOUNDRY_RESOURCE = "my-resource";
		process.env.KIMI_FOUNDRY_BASE_URL = "https://custom.example.com/openai/v1/";

		const auth = await models().getAuth("azure-moonshotai-foundry");

		expect(auth?.auth.baseUrl).toBe("https://custom.example.com/openai/v1/");
	});

	// Azure gateways authenticate with `api-key`; the OpenAI SDK only sends a bearer token.
	it("mirrors the key into an api-key header", async () => {
		process.env.KIMI_FOUNDRY_API_KEY = "test-key";
		process.env.KIMI_FOUNDRY_RESOURCE = "my-resource";

		const auth = await models().getAuth("azure-moonshotai-foundry");

		expect(auth?.auth.apiKey).toBe("test-key");
		expect(auth?.auth.headers).toMatchObject({ "api-key": "test-key" });
	});

	it("is unconfigured without an api key", async () => {
		process.env.KIMI_FOUNDRY_RESOURCE = "my-resource";

		expect(await models().getAuth("azure-moonshotai-foundry")).toBeUndefined();
	});

	it("uses the OpenAI-compatible chat completions path", async () => {
		const model = models().getModel("azure-moonshotai-foundry", "Kimi-K2.7-Code") as Model<"openai-completions">;
		let requested: string | undefined;
		const fetch: typeof globalThis.fetch = async (input) => {
			requested = input instanceof Request ? input.url : String(input);
			return new Response("boom", { status: 500 });
		};

		const events = stream(
			{ ...model, baseUrl: "https://my-resource.services.ai.azure.com/openai/v1/" },
			{ messages: [{ role: "user", content: "hi", timestamp: 0 }] },
			{ apiKey: "test-key", fetch, maxRetries: 0 },
		);
		for await (const _event of events) {
			// drain until the request fails
		}

		expect(requested).toBe("https://my-resource.services.ai.azure.com/openai/v1/chat/completions");
	});

	it("rejects when no endpoint is configured", async () => {
		process.env.KIMI_FOUNDRY_API_KEY = "test-key";

		await expect(models().getAuth("azure-moonshotai-foundry")).rejects.toThrow(
			/KIMI_FOUNDRY_RESOURCE or KIMI_FOUNDRY_BASE_URL/,
		);
	});
});
