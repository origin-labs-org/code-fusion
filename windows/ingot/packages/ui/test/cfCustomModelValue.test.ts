import { describe, expect, it } from "vitest";
import {
  decodeCustomModelValue,
  encodeCustomModelValue,
} from "../src/lib/cfCustomModelValue.js";

describe("CodeFusion custom model value", () => {
  it("编码并解码 provider/model 身份", () => {
    const value = encodeCustomModelValue("provider:a", "model/b");
    expect(decodeCustomModelValue(value)).toEqual({
      providerId: "provider:a",
      modelName: "model/b",
    });
  });

  it("Retain capability to parse historical values missing model", () => {
    expect(decodeCustomModelValue("custom:provider-a")).toEqual({
      providerId: "provider-a",
    });
  });

  it("Reject plain model values", () => {
    expect(decodeCustomModelValue("glm-5")).toBeNull();
  });
});
