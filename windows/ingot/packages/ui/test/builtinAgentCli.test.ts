import { describe, expect, it } from "vitest";
import { resolveBuiltinAgentCliStatus } from "@/lib/builtinAgentCli.js";

describe("resolveBuiltinAgentCliStatus", () => {
  it("Non-installable built-in providers do not rely on settings enabled list", () => {
    expect(
      resolveBuiltinAgentCliStatus({
        provider: "glm",
        enabledProviders: [],
        enablingProvider: null,
        disablingProvider: null,
      }),
    ).toBe("enabled");
  });
});
