import { describe, expect, it } from "vitest";
import { sortModelProvidersForDisplay } from "@/lib/modelProviderOrdering.js";

describe("sortModelProvidersForDisplay", () => {
  it("Keep Registry View input order when no explicit order is provided", () => {
    const providers = [
      { providerId: "account:bigmodel-individual-coding-plan" },
      { providerId: "account:zai-start-plan" },
      { providerId: "personal-provider" },
    ];

    expect(sortModelProvidersForDisplay(providers).map((provider) => provider.providerId)).toEqual([
      "account:bigmodel-individual-coding-plan",
      "account:zai-start-plan",
      "personal-provider",
    ]);
  });

  it("Explicit order overrides input order; unlisted providers keep relative order", () => {
    const providers = [{ providerId: "a" }, { providerId: "b" }, { providerId: "c" }];

    expect(
      sortModelProvidersForDisplay(providers, { providerIds: ["c", "a"] }).map(
        (provider) => provider.providerId,
      ),
    ).toEqual(["c", "a", "b"]);
  });
});
