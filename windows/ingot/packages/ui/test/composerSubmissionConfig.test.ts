import { describe, expect, it } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-services";
import { createComposerSubmissionConfig } from "@/v4/composer/composerSubmissionConfig.js";

const view = {
  revision: 1,
  providers: [
    {
      providerId: "provider-a",
      config: {},
      models: [
        {
          modelId: "model-a",
          config: {
            optionSpecs: { reasoningLevel: { values: ["low", "high"], map: "{}" } },
          },
        },
      ],
    },
  ],
  preferredSelection: {
    providerId: "provider-a",
    modelId: "model-a",
    options: { reasoningLevel: "high" },
  },
} as ModelSelectionView;

describe("createComposerSubmissionConfig", () => {
  it("Return empty config without throwing errors when no Composer draft exists", () => {
    expect(createComposerSubmissionConfig(undefined, null)).toBeNull();
  });
  it("Only copy config from Composer; subsequent edits cannot modify submitted values", () => {
    const draft = {
      mode: "yolo",
      planEnabled: true,
      modelSelection: {
        providerId: "provider-a",
        modelId: "model-a",
        options: { reasoningLevel: "low" },
      },
    };
    const submission = createComposerSubmissionConfig(draft, view);
    draft.mode = "yolo";
    draft.planEnabled = false;
    draft.modelSelection.options.reasoningLevel = "high";
    expect(submission).toEqual({
      mode: "yolo",
      planEnabled: true,
      modelSelection: {
        providerId: "provider-a",
        modelId: "model-a",
        options: { reasoningLevel: "low" },
      },
    });
    expect(Object.isFrozen(submission?.modelSelection.options)).toBe(true);
  });

  it("Empty selections, empty tiers, and invalid tiers do not create a Submission or use preferred", () => {
    for (const modelSelection of [
      undefined,
      { providerId: "provider-a", modelId: "model-a" },
      { providerId: "provider-a", modelId: "model-a", options: { reasoningLevel: "removed" } },
      { providerId: "removed", modelId: "model-a", options: { reasoningLevel: "high" } },
    ]) {
      expect(createComposerSubmissionConfig({ mode: "build", modelSelection }, view)).toBeNull();
    }
  });

  it("Legacy flat display fields cannot complete current Selection", () => {
    const draft = { mode: "build", provider: "provider-a", model: "model-a", thought: "high" };
    expect(createComposerSubmissionConfig(draft, view)).toBeNull();
  });

  it("Do not submit without Ready View or a valid mode", () => {
    const draft = { mode: "build", modelSelection: view.preferredSelection! };
    expect(createComposerSubmissionConfig(draft, null)).toBeNull();
    expect(createComposerSubmissionConfig({ ...draft, mode: "removed" }, view)).toBeNull();
  });
});
