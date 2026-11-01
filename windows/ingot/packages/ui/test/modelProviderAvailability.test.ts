import { describe, expect, it } from "vitest";
import {
  resolveProviderAvailabilityState,
} from "@/lib/modelProviderAvailability.js";

describe("modelProviderAvailability", () => {
  it("New Host only uses Registry Selection View to determine startup readiness", () => {
    expect(
      resolveProviderAvailabilityState({
        modelSelectionView: {
          revision: 3,
          providers: [
            {
              providerId: "registry-provider",
              config: { kind: "api" },
              models: [{ modelId: "registry-model", config: {} }],
            },
          ],
        },
      }),
    ).toEqual({
      source: "registry",
      hydrated: true,
      providerCount: 1,
      hasUsableProvider: true,
    });
  });

  it("Does not roll back to old Provider Snapshot when Registry has confirmed an empty View", () => {
    expect(
      resolveProviderAvailabilityState({
        modelSelectionView: { revision: 4, providers: [] },
      }),
    ).toEqual({
      source: "registry",
      hydrated: true,
      providerCount: 0,
      hasUsableProvider: false,
    });
  });

  it("Does not prematurely allow startup before Registry hydration", () => {
    expect(
      resolveProviderAvailabilityState({
        modelSelectionView: null,
      }),
    ).toEqual({
      source: "registry",
      hydrated: false,
      providerCount: 0,
      hasUsableProvider: false,
    });
  });

});
