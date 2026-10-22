import { anthropicMessagesApi } from "../api/anthropic-messages.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import { AZURE_ANTHROPIC_FOUNDRY_MODELS } from "./azure-anthropic-foundry.models.ts";
import { azureFoundryApiKeyAuth } from "./azure-foundry-auth.ts";

/**
 * Azure AI Foundry hosts Anthropic Claude via `/anthropic/` on
 * `https://<resource>.services.ai.azure.com/`. baseUrl is resolved per
 * request from `ANTHROPIC_FOUNDRY_BASE_URL` or `ANTHROPIC_FOUNDRY_RESOURCE`.
 */
export function azureAnthropicFoundryProvider(): Provider<"anthropic-messages"> {
	return createProvider({
		id: "azure-anthropic-foundry",
		name: "Azure AI Foundry (Anthropic)",
		auth: {
			apiKey: azureFoundryApiKeyAuth({
				apiKeyEnv: "ANTHROPIC_FOUNDRY_API_KEY",
				baseUrlEnv: "ANTHROPIC_FOUNDRY_BASE_URL",
				resourceEnv: "ANTHROPIC_FOUNDRY_RESOURCE",
				resourceBaseUrl: (resource) => `https://${resource}.services.ai.azure.com/anthropic/`,
				normalizeBaseUrl: (baseUrl) => (baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`),
			}),
		},
		models: Object.values(AZURE_ANTHROPIC_FOUNDRY_MODELS),
		api: anthropicMessagesApi(),
	});
}
