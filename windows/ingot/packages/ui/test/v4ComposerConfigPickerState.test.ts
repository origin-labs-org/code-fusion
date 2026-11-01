import { describe, expect, it } from "vitest";
import { resolveV4ComposerConfigPickerState } from "@/v4/composer/configPickerState.js";

describe("V4 composer config picker state", () => {
  it("New picker 接管后IgnoreOld picker 迟到的Close回调", () => {
    let active = resolveV4ComposerConfigPickerState(null, "mode", true);
    active = resolveV4ComposerConfigPickerState(active, "model", true);
    active = resolveV4ComposerConfigPickerState(active, "mode", false);

    expect(active).toBe("model");
    expect(resolveV4ComposerConfigPickerState(active, "model", false)).toBeNull();
  });
});
