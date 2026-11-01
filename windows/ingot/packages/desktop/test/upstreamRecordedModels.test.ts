import { describe, expect, it } from "vitest";
import {
  RECORDED_UPSTREAM_MODEL,
  RECORDED_UPSTREAM_SECONDARY_MODEL,
  resolveUpstreamModels,
} from "./e2e/helpers/upstream-recorded-models.js";

describe("E2E 上游模型", () => {
  it("Playback always uses the model from recording fixtures, unaffected by local model environment variables", () => {
    expect(
      resolveUpstreamModels({
        E2E_PROVIDER_HTTP_MODE: "replay",
        E2E_PROVIDER_MODEL: "local-model",
        E2E_PROVIDER_SECONDARY_MODEL: "local-secondary",
      }),
    ).toEqual({
      model: RECORDED_UPSTREAM_MODEL,
      secondaryModel: RECORDED_UPSTREAM_SECONDARY_MODEL,
    });
    expect(resolveUpstreamModels({ E2E_PROVIDER_MODEL: "local-model" }).model).toBe(
      RECORDED_UPSTREAM_MODEL,
    );
  });

  it("capture mode uses the model specified by environment variables, falling back to recorded model if unspecified", () => {
    expect(
      resolveUpstreamModels({
        E2E_PROVIDER_HTTP_MODE: "capture",
        E2E_PROVIDER_MODEL: "model-a",
      }),
    ).toEqual({ model: "model-a", secondaryModel: RECORDED_UPSTREAM_SECONDARY_MODEL });
  });
});
