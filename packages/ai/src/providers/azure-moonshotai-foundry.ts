import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import type { ApiKeyAuth } from "../auth/types.ts";
import { createProvider, type Provider } from "../models.ts";
import { AZURE_MOONSHOTAI_FOUNDRY_MODELS } from "./azure-moonshotai-foundry.models.ts";

/**
 * Azure AI Foundry hosts Moonshot Kimi through its OpenAI-compatible
 * `https://<resource>.services.ai.azure.com/openai/v1/` endpoint. baseUrl is
 * resolved per request from `KIMI_FOUNDRY_BASE_URL` or
 * `KIMI_FOUNDRY_RESOURCE`. Azure gateways authenticate with `api-key`, so the
 * key is mirrored into that header alongside the SDK's bearer token.
 */
function foundryBaseUrl(baseUrl: string | undefined, resource: string | undefined): string | undefined {
	if (baseUrl) return baseUrl;
	if (resource) return `https://${resource}.services.ai.azure.com/openai/v1/`;
	return undefined;
}

const azureFoundryApiKeyAuth: ApiKeyAuth = {
	name: "Azure AI Foundry API key",
	login: async (callbacks) => {
		const key = await callbacks.prompt({
			type: "secret",
			message: "Enter Azure Foundry API key (KIMI_FOUNDRY_API_KEY)",
		});
		return { type: "api_key", key };
	},
	resolve: async ({ ctx, credential }) => {
		const apiKey = credential?.key ?? (await ctx.env("KIMI_FOUNDRY_API_KEY"));
		if (!apiKey) return undefined;

		const baseUrl = credential?.env?.KIMI_FOUNDRY_BASE_URL ?? (await ctx.env("KIMI_FOUNDRY_BASE_URL"));
		const resource = credential?.env?.KIMI_FOUNDRY_RESOURCE ?? (await ctx.env("KIMI_FOUNDRY_RESOURCE"));
		const resolved = foundryBaseUrl(baseUrl, resource);
		if (!resolved) {
			throw new Error("Azure Foundry requires an endpoint. Set KIMI_FOUNDRY_RESOURCE or KIMI_FOUNDRY_BASE_URL.");
		}

		return {
			auth: {
				apiKey,
				baseUrl: resolved,
				headers: { "api-key": apiKey },
			},
			source: credential?.key ? "stored credential" : "KIMI_FOUNDRY_API_KEY",
		};
	},
};

export function azureMoonshotaiFoundryProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "azure-moonshotai-foundry",
		name: "Azure AI Foundry (Moonshot Kimi)",
		auth: { apiKey: azureFoundryApiKeyAuth },
		models: Object.values(AZURE_MOONSHOTAI_FOUNDRY_MODELS),
		api: openAICompletionsApi(),
	});
}
