import { describe, expect, it } from "vitest";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import type { SessionConfigState } from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolveSelectionSideInheritedModel } from "@/lib/selectionSideInheritedModel.js";
const view = {
  revision: 1,
  providers: [
    {
      providerId: "account:bigmodel-team-coding-plan",
      config: {},
      models: [
        { modelId: "glm-5", config: { optionSpecs: { reasoningLevel: { values: ["high"] } } } },
      ],
    },
  ],
} as unknown as ModelSelectionView;
const config: SessionConfigState = {
  provider: "account:bigmodel-team-coding-plan",
  model: "glm-5",
  thought: "high",
  thoughtLevels: ["high"],
  mode: "build",
  followupMode: "queue",
  modelSelection: { providerId: "account:bigmodel-individual-coding-plan", modelId: "glm-5" },
};
describe("Secondary screen recommended model source", () => {
  it("Use active projection and thinking from parent runtime, not old plan ID or main input draft", () => {
    expect(resolveSelectionSideInheritedModel(config, view)).toEqual({
      providerId: config.provider,
      modelId: config.model,
      options: { reasoningLevel: "high" },
    });
    expect(config.modelSelection?.providerId).toBe("account:bigmodel-individual-coding-plan");
  });
  it("Skip recommendation when directory, model, or valid thinking is missing; do not forge default selections", () => {
    expect(resolveSelectionSideInheritedModel(config, null)).toBeNull();
    expect(resolveSelectionSideInheritedModel({ ...config, thought: "invalid" }, view)).toBeNull();
    expect(resolveSelectionSideInheritedModel(null, view)).toBeNull();
  });
});
