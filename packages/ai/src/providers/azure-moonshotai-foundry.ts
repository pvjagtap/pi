import { openAICompletionsApi } from "../api/openai-completions.lazy.ts";
import { createProvider, type Provider } from "../models.ts";
import {
	type AzureFoundryAuthConfig,
	azureFoundryApiKeyAuth,
	azureFoundryDeploymentCatalog,
} from "./azure-foundry-auth.ts";
import { AZURE_MOONSHOTAI_FOUNDRY_MODELS } from "./azure-moonshotai-foundry.models.ts";

/**
 * Azure AI Foundry hosts Moonshot Kimi through its OpenAI-compatible
 * `https://<resource>.services.ai.azure.com/openai/v1/` endpoint. baseUrl is
 * resolved per request from `KIMI_FOUNDRY_BASE_URL` (kept verbatim, may carry
 * `?api-version=...`) or `KIMI_FOUNDRY_RESOURCE`.
 */
const AUTH_CONFIG: AzureFoundryAuthConfig = {
	apiKeyEnv: "KIMI_FOUNDRY_API_KEY",
	baseUrlEnv: "KIMI_FOUNDRY_BASE_URL",
	resourceEnv: "KIMI_FOUNDRY_RESOURCE",
	resourceBaseUrl: (resource) => `https://${resource}.services.ai.azure.com/openai/v1/`,
};

/** Narrow the catalog to the Kimi deployments of the user's Foundry resource. */
export const personalizeAzureMoonshotaiFoundryCatalog = azureFoundryDeploymentCatalog(AUTH_CONFIG);

export function azureMoonshotaiFoundryProvider(): Provider<"openai-completions"> {
	return createProvider({
		id: "azure-moonshotai-foundry",
		name: "Azure AI Foundry (Moonshot Kimi)",
		auth: { apiKey: azureFoundryApiKeyAuth(AUTH_CONFIG) },
		models: Object.values(AZURE_MOONSHOTAI_FOUNDRY_MODELS),
		api: openAICompletionsApi(),
	});
}
