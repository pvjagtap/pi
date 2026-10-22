import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";

const customModel = {
	id: "custom-model",
	name: "custom-model",
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 10000,
	maxTokens: 1000,
};

function customProvider() {
	return {
		baseUrl: "https://example.test/v1",
		api: "openai-completions",
		apiKey: "custom-key",
		models: [customModel],
	};
}

describe("ModelRuntime enabled providers", () => {
	const tempDirs: string[] = [];
	afterEach(() => {
		vi.unstubAllEnvs();
		for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function createRuntime(modelsJson: object): Promise<ModelRuntime> {
		const dir = mkdtempSync(join(tmpdir(), "pi-enabled-providers-"));
		tempDirs.push(dir);
		const modelsPath = join(dir, "models.json");
		writeFileSync(modelsPath, JSON.stringify(modelsJson));
		const credentials = AuthStorage.inMemory();
		await credentials.modify("anthropic", async () => ({ type: "api_key", key: "anthropic-key" }));
		await credentials.modify("openai", async () => ({ type: "api_key", key: "openai-key" }));
		return ModelRuntime.create({
			credentials,
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: false,
		});
	}

	function providerIds(runtime: ModelRuntime): string[] {
		return runtime
			.getProviders()
			.map((provider) => provider.id)
			.sort();
	}

	it("removes every provider outside enabledProviders, including configured custom ones", async () => {
		const runtime = await createRuntime({
			enabledProviders: ["openai", "allowed-custom"],
			providers: { "allowed-custom": customProvider(), "blocked-custom": customProvider() },
		});

		expect(providerIds(runtime)).toEqual(["allowed-custom", "openai"]);
		const available = new Set((await runtime.getAvailable()).map((model) => model.provider));
		expect(available).toEqual(new Set(["allowed-custom", "openai"]));
		// A stored credential does not bring a blocked provider back.
		expect(runtime.getModel("anthropic", "claude-opus-4-8")).toBeUndefined();
		expect(runtime.getModel("blocked-custom", "custom-model")).toBeUndefined();
	});

	it("keeps blocking providers that extensions register later", async () => {
		const runtime = await createRuntime({ enabledProviders: ["openai"] });

		runtime.registerProvider("extension-provider", customProvider());

		expect(providerIds(runtime)).toEqual(["openai"]);
	});

	it("lets PI_ENABLED_PROVIDERS override the models.json list", async () => {
		vi.stubEnv("PI_ENABLED_PROVIDERS", " anthropic , ");
		const runtime = await createRuntime({ enabledProviders: ["openai"] });

		expect(providerIds(runtime)).toEqual(["anthropic"]);
	});

	it("enables every provider when no allowlist is set", async () => {
		const runtime = await createRuntime({ providers: { "allowed-custom": customProvider() } });

		expect(providerIds(runtime)).toEqual(expect.arrayContaining(["allowed-custom", "anthropic", "openai"]));
	});
});
