import type { RefreshModelsContext } from "../models.ts";
import type { AnyModel } from "../types.ts";
import { isModelType } from "../utils/model-operations.ts";

const AZURE_DEPLOYMENTS_TIMEOUT_MS = 15_000;
// Newer data-plane API versions return 404 for this route; 2022-12-01 still lists deployments with an api-key.
const AZURE_DEPLOYMENTS_API_VERSION = "2022-12-01";

/**
 * Names of the resource's succeeded deployments. Undefined when the resource rejects the request
 * (401/403/404), in which case callers keep the full catalog.
 */
async function listAzureDeployments(
	baseUrl: string,
	apiKey: string,
	signal: AbortSignal,
): Promise<Set<string> | undefined> {
	const url = `${new URL(baseUrl).origin}/openai/deployments?api-version=${AZURE_DEPLOYMENTS_API_VERSION}`;
	const response = await fetch(url, {
		headers: { accept: "application/json", "api-key": apiKey },
		signal: AbortSignal.any([signal, AbortSignal.timeout(AZURE_DEPLOYMENTS_TIMEOUT_MS)]),
	});
	if (response.status === 401 || response.status === 403 || response.status === 404) return undefined;
	if (!response.ok) throw new Error(`Azure deployment list request failed: ${response.status}`);
	const body: unknown = await response.json();
	if (typeof body !== "object" || body === null || !("data" in body) || !Array.isArray(body.data)) {
		throw new Error("Invalid Azure deployment list response");
	}
	const names = new Set<string>();
	for (const entry of body.data as unknown[]) {
		if (typeof entry !== "object" || entry === null || !("id" in entry) || typeof entry.id !== "string") continue;
		if ("status" in entry && entry.status !== "succeeded") continue;
		names.add(entry.id);
	}
	return names;
}

export interface AzureDeploymentCatalogOptions {
	/** Endpoint of the Azure resource for this refresh; undefined keeps the full catalog. */
	baseUrl(context: RefreshModelsContext): string | undefined;
	/** Deployment that serves a model. Defaults to the model id. */
	deploymentName?(model: AnyModel, context: RefreshModelsContext): string;
}

/**
 * Personalize an Azure catalog to the chat models deployed on the user's resource. Requests send the
 * model's deployment name, so an undeployed model can only fail with DeploymentNotFound. Image and
 * classifier models are returned unchanged.
 */
export function azureDeploymentCatalog(
	options: AzureDeploymentCatalogOptions,
): (catalog: readonly AnyModel[], context: RefreshModelsContext) => Promise<readonly AnyModel[]> {
	return async (catalog, context) => {
		const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
		const baseUrl = options.baseUrl(context);
		if (!apiKey || !baseUrl) return catalog;
		const deployments = await listAzureDeployments(baseUrl, apiKey, context.signal);
		if (!deployments) return catalog;
		return catalog.filter(
			(model) =>
				!isModelType(model, "chat") || deployments.has(options.deploymentName?.(model, context) ?? model.id),
		);
	};
}
