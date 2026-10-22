import type { ApiKeyAuth } from "../auth/types.ts";
import { azureDeploymentCatalog } from "./azure-deployments.ts";

export interface AzureFoundryAuthConfig {
	/** Env var holding the Foundry key, e.g. `ANTHROPIC_FOUNDRY_API_KEY`. */
	apiKeyEnv: string;
	/** Env var holding a full endpoint URL; wins over `resourceEnv`. */
	baseUrlEnv: string;
	/** Env var holding the Foundry resource name. */
	resourceEnv: string;
	/** Endpoint for a resource name, e.g. `https://<resource>.services.ai.azure.com/anthropic/`. */
	resourceBaseUrl(resource: string): string;
	/** Optional fix-up for an explicit `baseUrlEnv` value. */
	normalizeBaseUrl?(baseUrl: string): string;
}

/**
 * Api-key auth for Azure AI Foundry deployments. The endpoint is per user, so it
 * is resolved alongside the key. Azure gateways authenticate with `api-key`, so
 * the key is also mirrored into that header next to the SDK's own auth header.
 */
export function azureFoundryApiKeyAuth(config: AzureFoundryAuthConfig): ApiKeyAuth {
	return {
		name: "Azure AI Foundry API key",
		login: async (interaction) => {
			interaction.signal.throwIfAborted();
			const key = await interaction.prompt({
				type: "secret",
				message: `Enter Azure Foundry API key (${config.apiKeyEnv})`,
			});
			interaction.signal.throwIfAborted();
			return { type: "api_key", key };
		},
		// Availability depends on the key only. A missing endpoint must not reject
		// `getAvailable()`, which checks every provider together; `resolve()` reports
		// it when a request is made.
		check: async ({ ctx, credential, signal }) => {
			signal.throwIfAborted();
			if (credential?.key) return { type: "api_key", source: "stored credential" };
			const apiKey = await ctx.env(config.apiKeyEnv);
			signal.throwIfAborted();
			return apiKey ? { type: "api_key", source: config.apiKeyEnv } : undefined;
		},
		resolve: async ({ ctx, credential, signal }) => {
			signal.throwIfAborted();
			const apiKey = credential?.key ?? (await ctx.env(config.apiKeyEnv));
			signal.throwIfAborted();
			if (!apiKey) return undefined;

			const baseUrl = credential?.env?.[config.baseUrlEnv] ?? (await ctx.env(config.baseUrlEnv));
			const resource = credential?.env?.[config.resourceEnv] ?? (await ctx.env(config.resourceEnv));
			signal.throwIfAborted();
			let resolved: string | undefined;
			if (baseUrl) {
				resolved = config.normalizeBaseUrl ? config.normalizeBaseUrl(baseUrl) : baseUrl;
			} else if (resource) {
				resolved = config.resourceBaseUrl(resource);
			}
			if (!resolved) {
				throw new Error(`Azure Foundry requires an endpoint. Set ${config.resourceEnv} or ${config.baseUrlEnv}.`);
			}

			return {
				auth: { apiKey, baseUrl: resolved, headers: { "api-key": apiKey } },
				// Model refreshes see only the credential and its env, so they need the endpoint here.
				env: { ...credential?.env, [config.baseUrlEnv]: resolved },
				source: credential?.key ? "stored credential" : config.apiKeyEnv,
			};
		},
	};
}

/** Keep only the Foundry models deployed on the resource that `azureFoundryApiKeyAuth(config)` resolves. */
export function azureFoundryDeploymentCatalog(config: AzureFoundryAuthConfig) {
	return azureDeploymentCatalog({
		baseUrl: (context) =>
			context.credential?.type === "api_key" ? context.credential.env?.[config.baseUrlEnv] : undefined,
	});
}
