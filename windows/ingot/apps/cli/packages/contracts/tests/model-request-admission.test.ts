import { describe, expect, it } from "vitest";
import { modelTextRequestJsonSchema } from "../src/model/index.js";

describe("ModelRequestAdmission", () => {
  it("is a runtime-only request field and stays out of the model request JSON schema", () => {
    const properties = (modelTextRequestJsonSchema as { properties: Record<string, unknown> })
      .properties;
    expect(properties).not.toHaveProperty("modelRequestAdmission");
  });
});
