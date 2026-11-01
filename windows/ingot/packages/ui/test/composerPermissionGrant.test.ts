import { describe, expect, it } from "vitest";
import { sortPermissionOptions } from "../src/lib/permissionRequest.js";

describe("Targeted sync of approval permissions", () => {
  it("Full access is ordered after Always Allow and before Deny, without relying on index to determine response", () => {
    const options = [
      { optionId: "deny", kind: "deny" },
      { optionId: "fullAccess", kind: "custom" },
      { optionId: "allowAlways", kind: "allow_always" },
      { optionId: "allowOnce", kind: "allow_once" },
    ].map((option) => ({
      ...option,
      name: option.optionId,
      response: { decision: "deny" as const },
    }));
    expect(sortPermissionOptions(options).map((option) => option.optionId)).toEqual([
      "allowOnce",
      "allowAlways",
      "fullAccess",
      "deny",
    ]);
  });
});
