import { describe, expect, it } from "vitest";
import { formatModelPickerValue, cfSessionSettingsStateSchema } from "../src/index.js";

describe("未绑定模型的协议与显示边界", () => {
  it("Allow settings to have no current model without spoofing a valid identity via empty Provider/Model", () => {
    const settings = {
      model: { available: [] },
      thoughtLevel: { enabled: false, available: [] },
      mode: { current: "build" },
    };
    expect(cfSessionSettingsStateSchema.parse(settings).model.current).toBeUndefined();
    expect(
      cfSessionSettingsStateSchema.safeParse({
        ...settings,
        model: { ...settings.model, current: { providerId: "", modelId: "" } },
      }).success,
    ).toBe(false);
  });

  it("Empty selection in model control displays as empty, while actual selection retains full encoding", () => {
    expect(formatModelPickerValue(undefined)).toBe("");
    expect(formatModelPickerValue({ providerId: "p", modelId: "m" })).toBe("p/m");
  });
});
