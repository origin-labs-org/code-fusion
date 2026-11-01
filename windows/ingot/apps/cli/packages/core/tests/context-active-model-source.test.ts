import { describe, expect, it } from "vitest";
import type { EnvInfo } from "@origin-ai/cf-contracts";
import { createContextBuilder } from "../src/context/builder.js";
import { createSubagentContextBuilder } from "../src/subagent/context-builder.js";
import { createTestRuntimeModel } from "./test-runtime-model.js";

const envInfo: EnvInfo = {
  cwd: "/workspace",
  platform: "linux",
  shell: "bash",
  osVersion: "Linux",
  nodeVersion: "v24",
};
const model = createTestRuntimeModel({
  providerId: "actual-provider",
  modelId: "shared-name",
  generateText: async () => {
    throw new Error("context building must not call the provider");
  },
});

describe("Context execution model source", () => {
  for (const kind of ["main", "subagent"] as const) {
    const build = (source: EnvInfo, withModel: boolean) => {
      const config = { envInfo: source, model: withModel ? model : undefined };
      const result =
        kind === "main"
          ? createContextBuilder({ ...config, workingDirectory: "/workspace" }).build()
          : createSubagentContextBuilder({
              ...config,
              agentPrompt: "Inspect the workspace.",
            }).build();
      return result.systemMessages.map((message) => String(message.content)).join("\n");
    };

    it(`${kind} renders the actual Model without putting model identity into EnvInfo`, () => {
      expect(build(envInfo, true)).toContain(
        "powered by the model named actual-provider/shared-name",
      );
      expect(envInfo).not.toHaveProperty("currentModel");
    });

    it(`${kind} ignores a legacy environment model even when no execution Model exists`, () => {
      const legacyEnvironment = { ...envInfo, currentModel: "legacy/wrong-model" };
      expect(build(legacyEnvironment, false)).not.toContain("powered by the model named");
      expect(build(legacyEnvironment, true)).not.toContain("legacy/wrong-model");
      expect(build(legacyEnvironment, true)).toContain("actual-provider/shared-name");
    });
  }
});
