import { describe, expect, it } from "vitest";
import { cfProviderRuntimeHeadersResponseSchema } from "@origin-ai/cf-shared";

describe("request-scoped provider runtime headers response", () => {
  it("preserves the paired PAT and ID across the private protocol and rejects empty IDs", () => {
    const response = { headersApplied: true, requestAuth: { apiKey: "pat", apiKeyId: "key-id" } };
    expect(cfProviderRuntimeHeadersResponseSchema.parse(response)).toEqual(response);
    expect(
      cfProviderRuntimeHeadersResponseSchema.safeParse({
        ...response,
        requestAuth: { apiKeyId: " " },
      }).success,
    ).toBe(false);
  });
  it("requires headers on success instead of acknowledging a shared config mutation", () => {
    expect(
      cfProviderRuntimeHeadersResponseSchema.safeParse({ headersApplied: true }).success,
    ).toBe(false);
    expect(
      cfProviderRuntimeHeadersResponseSchema.parse({
        headersApplied: true,
        requestAuth: {
          headers: {
            "X-Request-Scoped-Param": "request-token",
            "X-Request-Scoped-Region": "cn",
          },
        },
      }).headersApplied,
    ).toBe(true);
  });
  it("preserves setup errors and rejects unexpected fields", () => {
    expect(
      cfProviderRuntimeHeadersResponseSchema.safeParse({
        headersApplied: true,
        runtimeProviderHeaders: { token: "legacy" },
      }).success,
    ).toBe(false);
    expect(
      cfProviderRuntimeHeadersResponseSchema.parse({
        headersApplied: false,
        errorMessage: "SDK initialization timeout",
      }),
    ).toEqual({ headersApplied: false, errorMessage: "SDK initialization timeout" });
    expect(
      cfProviderRuntimeHeadersResponseSchema.safeParse({
        headersApplied: false,
        runtimeProviderHeaders: { token: "unexpected" },
      }).success,
    ).toBe(false);
  });
});
