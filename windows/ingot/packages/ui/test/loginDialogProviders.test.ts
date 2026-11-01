import {
  BIGMODEL_PROVIDER_ID,
  type OAuthProviderMeta,
  ZAI_PROVIDER_ID,
} from "@origin-ai/cf-shared";
import { describe, expect, it } from "vitest";
import {
  resolveLoginRetryProvider,
  resolveVisibleLoginProviders,
} from "@/WelcomeScreen.js";

function createProvider(
  overrides: Partial<OAuthProviderMeta>,
): OAuthProviderMeta {
  return {
    id: overrides.id ?? "custom-oauth",
    displayName: overrides.displayName ?? "Custom OAuth",
    enabled: overrides.enabled ?? true,
    order: overrides.order ?? 10,
  };
}

describe("resolveVisibleLoginProviders", () => {
  it("Not-logged-in modal shows both ZAI and BigModel entries", () => {
    const providers = resolveVisibleLoginProviders([
      createProvider({
        id: BIGMODEL_PROVIDER_ID,
        displayName: "BigModel",
        order: 0,
      }),
      createProvider({
        id: ZAI_PROVIDER_ID,
        displayName: "Z.ai",
        order: 1,
      }),
    ]);

    expect(providers.map((provider) => provider.id)).toEqual([
      ZAI_PROVIDER_ID,
      BIGMODEL_PROVIDER_ID,
    ]);
  });
});

describe("resolveLoginRetryProvider", () => {
  it("Prefer recently failed provider after OAuth failure instead of falling back to providers[0]", () => {
    const providers = [
      createProvider({
        id: BIGMODEL_PROVIDER_ID,
        displayName: "BigModel",
        order: 0,
      }),
      createProvider({
        id: ZAI_PROVIDER_ID,
        displayName: "Z.ai",
        order: 1,
      }),
    ];

    expect(
      resolveLoginRetryProvider({
        pendingProvider: null,
        lastAttemptProvider: ZAI_PROVIDER_ID,
        providers,
      }),
    ).toBe(ZAI_PROVIDER_ID);
  });

  it("Still prefer current pending provider before waiting state cancellation", () => {
    const providers = [
      createProvider({
        id: BIGMODEL_PROVIDER_ID,
        displayName: "BigModel",
        order: 0,
      }),
    ];

    expect(
      resolveLoginRetryProvider({
        pendingProvider: ZAI_PROVIDER_ID,
        lastAttemptProvider: BIGMODEL_PROVIDER_ID,
        providers,
      }),
    ).toBe(ZAI_PROVIDER_ID);
  });
});
