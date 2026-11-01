import { describe, expect, it } from "vitest";
import type { CfSessionSettingsState } from "@origin-ai/cf-shared";
import {
  getCfAgentAvailableModes,
  normalizeAvailableCfMode,
  settingsToConfigOptions,
} from "../src/cf-agent/cfConfigOptions.js";

function settingsWithMode(
  mode: CfSessionSettingsState["mode"]["current"],
): CfSessionSettingsState {
  return {
    model: {
      current: { providerId: "glm", modelId: "glm-5" },
      available: [],
    },
    thoughtLevel: {
      enabled: false,
      available: [],
    },
    mode: { current: mode },
  };
}

describe("cfConfigOptions", () => {
  it("keeps persisted edit while the shared menu replaces it with guarded", () => {
    const options = settingsToConfigOptions(settingsWithMode("edit"));
    const modeOption = options.find((option) => option.category === "mode");

    expect(modeOption?.currentValue).toBe("edit");
    expect(modeOption?.options?.map((option) => option.value)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(getCfAgentAvailableModes().map((mode) => mode.id)).toEqual([
      "build",
      "guarded",
      "plan",
      "yolo",
    ]);
    expect(normalizeAvailableCfMode("edit")).toBe("edit");
  });
});
