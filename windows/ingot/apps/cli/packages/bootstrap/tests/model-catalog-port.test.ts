

import { describe, expect, it } from "vitest";
import type { ModelSelection } from "@origin-ai/cf-shared/model-selection";
import { createModelCatalogPort } from "../src/app/model-catalog-port.js";
import type { ProviderRegistryModelSource } from "../src/app/provider-registry-model-runtime.js";

interface FakeModel {
  modelId: string;
  reasoningLevels: string[];
  contextWindow?: number;
}

interface FakeProvider {
  providerId: string;
  
  providerName?: string | null;
  models: FakeModel[];
}

function fakeRegistry(providers: FakeProvider[]): {
  registry: ProviderRegistryModelSource;
  setProviders: (next: FakeProvider[]) => void;
  viewReads: () => number;
} {
  let current = providers;
  let reads = 0;
  const registry = {
    getView() {
      reads += 1;
      return {
        revision: reads,
        providers: current.map((provider) => ({
          providerId: provider.providerId,
          ...(provider.providerName === undefined ? {} : { providerName: provider.providerName }),
          config: {},
          models: provider.models.map((model) => ({
            modelId: model.modelId,
            config: {
              optionSpecs: { reasoningLevel: { values: model.reasoningLevels } },
              properties: { contextWindow: model.contextWindow },
            },
          })),
        })),
      };
    },
    getProvider() {
      throw new Error("the catalog port must not point-query the registry");
    },
    getModel() {
      throw new Error("the catalog port must not point-query the registry");
    },
    validateSelection() {
      throw new Error("the catalog port must not validate selections");
    },
    onDidChange() {
      throw new Error("the catalog port must not subscribe; it re-reads on every call");
    },
  } as unknown as ProviderRegistryModelSource;
  return {
    registry,
    setProviders: (next) => {
      current = next;
    },
    viewReads: () => reads,
  };
}

const ZHIPU: FakeProvider = {
  providerId: "zhipu",
  providerName: "Zhipu",
  models: [
    { modelId: "glm-5.3", reasoningLevels: ["low", "medium", "high"], contextWindow: 200_000 },
    { modelId: "glm-5.3-flash", reasoningLevels: [] },
  ],
};

describe("createModelCatalogPort", () => {
  it("re-reads the live registry view on every call (2026-09-02 stale provider incident)", () => {
    const fake = fakeRegistry([ZHIPU]);
    const port = createModelCatalogPort({ registry: fake.registry, currentSelection: () => undefined });

    expect(port.listModels().map((entry) => entry.modelId)).toEqual(["glm-5.3", "glm-5.3-flash"]);
    expect(fake.viewReads()).toBe(1);

    fake.setProviders([
      { providerId: "anthropic", models: [{ modelId: "sonnet", reasoningLevels: [] }] },
    ]);
    expect(port.listModels().map((entry) => `${entry.providerId}/${entry.modelId}`)).toEqual([
      "anthropic/sonnet",
    ]);
    expect(fake.viewReads()).toBe(2);
  });

  it("flags exactly the entry that matches the session selection, ignoring reasoning options", () => {
    const fake = fakeRegistry([
      ZHIPU,
      { providerId: "anthropic", models: [{ modelId: "glm-5.3", reasoningLevels: [] }] },
    ]);
    const selection: ModelSelection = {
      providerId: "zhipu",
      modelId: "glm-5.3",
      options: { reasoningLevel: "high" },
    };
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => selection,
    });

    const entries = port.listModels();
    expect(entries.filter((entry) => entry.current)).toHaveLength(1);
    expect(entries.find((entry) => entry.current)).toMatchObject({
      providerId: "zhipu",
      modelId: "glm-5.3",
    });
    expect(entries.find((entry) => entry.providerId === "anthropic")?.current).toBe(false);
  });

  it("no session selection at all: every entry is current: false", () => {
    const fake = fakeRegistry([ZHIPU]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    expect(port.listModels().every((entry) => entry.current === false)).toBe(true);
  });

  it("defaults the reasoning level to the last value (same rule as the GUI picker's toModelOption)", () => {
    const fake = fakeRegistry([ZHIPU]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    const [levelled] = port.listModels();
    expect(levelled).toMatchObject({
      providerId: "zhipu",
      modelId: "glm-5.3",
      providerLabel: "Zhipu",
      reasoningLevels: ["low", "medium", "high"],
      defaultReasoningLevel: "high",
      contextWindow: 200_000,
    });
  });

  it("a model with no reasoning levels gets an empty array and no default", () => {
    const fake = fakeRegistry([ZHIPU]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    const flash = port.listModels().find((entry) => entry.modelId === "glm-5.3-flash")!;
    expect(flash.reasoningLevels).toEqual([]);
    expect("defaultReasoningLevel" in flash).toBe(false);
    expect("contextWindow" in flash).toBe(false);
  });

  it("a provider with no display name leaves providerLabel absent, and no entry is ever disabled", () => {
    const fake = fakeRegistry([
      { providerId: "anonymous", models: [{ modelId: "m", reasoningLevels: [] }] },
    ]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    const [entry] = port.listModels();
    expect("providerLabel" in entry!).toBe(false);
    expect("disabledReason" in entry!).toBe(false);
  });

  it("null and blank provider names collapse to an absent key, never a printed empty label", () => {
    const fake = fakeRegistry([
      {
        providerId: "cleared",
        providerName: null,
        models: [{ modelId: "m", reasoningLevels: [] }],
      },
      { providerId: "blank", providerName: "   ", models: [{ modelId: "m", reasoningLevels: [] }] },
      {
        providerId: "named",
        providerName: "  Zhipu  ",
        models: [{ modelId: "m", reasoningLevels: [] }],
      },
    ]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    const [cleared, blank, named] = port.listModels();
    expect("providerLabel" in cleared!).toBe(false);
    expect("providerLabel" in blank!).toBe(false);
    expect(named!.providerLabel).toBe("Zhipu");
  });

  it("copies the reasoning level array so the caller cannot mutate the registry's view", () => {
    const levels = ["low", "high"];
    const fake = fakeRegistry([
      { providerId: "p", models: [{ modelId: "m", reasoningLevels: levels }] },
    ]);
    const port = createModelCatalogPort({
      registry: fake.registry,
      currentSelection: () => undefined,
    });
    port.listModels()[0]!.reasoningLevels.push("mutated");
    expect(levels).toEqual(["low", "high"]);
  });
});
