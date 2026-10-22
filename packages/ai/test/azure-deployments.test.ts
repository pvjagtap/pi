import { afterEach, describe, expect, it, vi } from "vitest";
import type { RefreshModelsContext } from "../src/models.ts";
import { personalizeAzureCatalog } from "../src/providers/azure.ts";
import { personalizeAzureAnthropicFoundryCatalog } from "../src/providers/azure-anthropic-foundry.ts";
import type { AnyModel } from "../src/types.ts";

function chat(id: string): AnyModel {
	return {
		id,
		name: id,
		api: "anthropic-messages",
		provider: "azure-anthropic-foundry",
		baseUrl: "",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1000,
		maxTokens: 100,
	} as AnyModel;
}

function context(env?: Record<string, string>): RefreshModelsContext {
	return {
		credential: { type: "api_key", key: "test-key", env },
		publish: async () => true,
		allowNetwork: true,
		signal: new AbortController().signal,
	};
}

function stubDeployments(response: Response): { urls: string[]; keys: (string | null)[] } {
	const seen = { urls: [] as string[], keys: [] as (string | null)[] };
	vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
		seen.urls.push(String(input));
		seen.keys.push(new Headers(init?.headers).get("api-key"));
		return response;
	});
	return seen;
}

function deployments(...entries: { id: string; status?: string }[]): Response {
	return Response.json({ data: entries.map((entry) => ({ status: "succeeded", ...entry })) });
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("Azure deployment catalogs", () => {
	it("keeps only models with a succeeded deployment on the Foundry resource", async () => {
		const seen = stubDeployments(
			deployments({ id: "claude-opus-4-8" }, { id: "claude-sonnet-5", status: "creating" }, { id: "gpt-5.4" }),
		);

		const models = await personalizeAzureAnthropicFoundryCatalog(
			[chat("claude-opus-4-8"), chat("claude-sonnet-5"), chat("claude-haiku-4-5")],
			context({ ANTHROPIC_FOUNDRY_BASE_URL: "https://my-resource.services.ai.azure.com/anthropic/" }),
		);

		expect(models.map((model) => model.id)).toEqual(["claude-opus-4-8"]);
		expect(seen.urls).toEqual([
			"https://my-resource.services.ai.azure.com/openai/deployments?api-version=2022-12-01",
		]);
		expect(seen.keys).toEqual(["test-key"]);
	});

	// A resource that does not allow listing must not leave the user without models.
	it.each([401, 403, 404])("keeps the full catalog when listing returns %i", async (status) => {
		stubDeployments(new Response("", { status }));
		const catalog = [chat("claude-opus-4-8"), chat("claude-haiku-4-5")];

		const models = await personalizeAzureAnthropicFoundryCatalog(
			catalog,
			context({ ANTHROPIC_FOUNDRY_BASE_URL: "https://my-resource.services.ai.azure.com/anthropic/" }),
		);

		expect(models).toEqual(catalog);
	});

	it("keeps the full catalog when the Foundry endpoint is unknown", async () => {
		const seen = stubDeployments(deployments());
		const catalog = [chat("claude-opus-4-8")];

		expect(await personalizeAzureAnthropicFoundryCatalog(catalog, context())).toEqual(catalog);
		expect(seen.urls).toEqual([]);
	});

	it("matches Azure OpenAI models through AZURE_OPENAI_DEPLOYMENT_NAME_MAP", async () => {
		vi.stubEnv("AZURE_OPENAI_BASE_URL", "https://my-resource.openai.azure.com");
		vi.stubEnv("AZURE_OPENAI_DEPLOYMENT_NAME_MAP", "gpt-5.5=my-gpt");
		const seen = stubDeployments(deployments({ id: "my-gpt" }, { id: "gpt-5.4" }));

		const models = await personalizeAzureCatalog([chat("gpt-5.5"), chat("gpt-5.4"), chat("gpt-6")], context());

		expect(models.map((model) => model.id)).toEqual(["gpt-5.5", "gpt-5.4"]);
		expect(seen.urls).toEqual(["https://my-resource.openai.azure.com/openai/deployments?api-version=2022-12-01"]);
	});
});
