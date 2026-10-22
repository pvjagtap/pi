/**
 * Utility functions for Azure OpenAI tests
 */

import { getModel } from "../src/compat.ts";
import type { Model } from "../src/types.ts";

function parseDeploymentNameMap(value: string | undefined): Map<string, string> {
	const map = new Map<string, string>();
	if (!value) return map;
	for (const entry of value.split(",")) {
		const trimmed = entry.trim();
		if (!trimmed) continue;
		const [modelId, deploymentName] = trimmed.split("=", 2);
		if (!modelId || !deploymentName) continue;
		map.set(modelId.trim(), deploymentName.trim());
	}
	return map;
}

export function hasAzureOpenAICredentials(): boolean {
	const hasKey = !!process.env.AZURE_OPENAI_API_KEY;
	const hasBaseUrl = !!(process.env.AZURE_OPENAI_BASE_URL || process.env.AZURE_OPENAI_RESOURCE_NAME);
	return hasKey && hasBaseUrl;
}

export function hasAzureAnthropicFoundryCredentials(): boolean {
	const hasKey = !!process.env.ANTHROPIC_FOUNDRY_API_KEY;
	const hasEndpoint = !!(process.env.ANTHROPIC_FOUNDRY_BASE_URL || process.env.ANTHROPIC_FOUNDRY_RESOURCE);
	return hasKey && hasEndpoint;
}

export function hasAzureMoonshotaiFoundryCredentials(): boolean {
	const hasKey = !!process.env.KIMI_FOUNDRY_API_KEY;
	const hasEndpoint = !!(process.env.KIMI_FOUNDRY_BASE_URL || process.env.KIMI_FOUNDRY_RESOURCE);
	return hasKey && hasEndpoint;
}

function foundryEndpoint(
	prefix: "ANTHROPIC" | "KIMI",
	path: string,
): { baseUrl: string; headers: Record<string, string> } {
	const resource = process.env[`${prefix}_FOUNDRY_RESOURCE`];
	const baseUrl =
		process.env[`${prefix}_FOUNDRY_BASE_URL`] ??
		(resource ? `https://${resource}.services.ai.azure.com/${path}` : "");
	return { baseUrl, headers: { "api-key": process.env[`${prefix}_FOUNDRY_API_KEY`] ?? "" } };
}

/**
 * Foundry Claude model for compat `stream()`, which resolves only the API key from env. The endpoint
 * and `api-key` header come from provider auth in `Models`, so they are set on the model here.
 * Uses a model that Foundry resources commonly deploy under its default name.
 */
export function azureAnthropicFoundryModel(): Model<"anthropic-messages"> {
	return { ...getModel("azure-anthropic-foundry", "claude-sonnet-5"), ...foundryEndpoint("ANTHROPIC", "anthropic/") };
}

/** Foundry Kimi model for compat `stream()`; see `azureAnthropicFoundryModel`. */
export function azureMoonshotaiFoundryModel(): Model<"openai-completions"> {
	return { ...getModel("azure-moonshotai-foundry", "Kimi-K2.7-Code"), ...foundryEndpoint("KIMI", "openai/v1/") };
}

export function resolveAzureDeploymentName(modelId: string): string | undefined {
	const mapValue = process.env.AZURE_OPENAI_DEPLOYMENT_NAME_MAP;
	if (!mapValue) return undefined;
	return parseDeploymentNameMap(mapValue).get(modelId);
}
