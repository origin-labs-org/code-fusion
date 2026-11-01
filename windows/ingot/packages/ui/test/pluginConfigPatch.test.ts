import { describe, expect, it } from "vitest";
import type { CfPluginInfo } from "@origin-ai/cf-shared";
import { buildPluginConfigPatch } from "../src/settings/pluginConfigPatch.js";

const plugin = {
  id: "demo@marketplace",
  name: "demo",
  enabled: true,
  userConfig: {
    region: { type: "string" },
    endpoint: { type: "string" },
    enabled: { type: "boolean" },
    retries: { type: "number" },
  },
  configuredOptions: {
    region: "us-east-1",
    endpoint: "https://example.test",
    enabled: true,
    retries: 3,
  },
} as CfPluginInfo;

describe("plugin config patch", () => {
  it("没有显式 draft 时返回空 patch", () => {
    expect(buildPluginConfigPatch(plugin, {})).toEqual({
      options: {},
      clearOptionKeys: [],
    });
  });

  it("Only submit explicitly modified options without solidifying other effective values", () => {
    expect(
      buildPluginConfigPatch(plugin, {
        region: "eu-west-1",
      }),
    ).toEqual({
      options: { region: "eu-west-1" },
      clearOptionKeys: [],
    });
  });

  it("Retain explicit false, 0, and empty string values", () => {
    expect(
      buildPluginConfigPatch(plugin, {
        enabled: false,
        retries: 0,
        endpoint: "",
      }),
    ).toEqual({
      options: { enabled: false, endpoint: "", retries: 0 },
      clearOptionKeys: [],
    });
  });

  it("Only clear specified option on revert to inherited; do not write effective value back", () => {
    expect(
      buildPluginConfigPatch(plugin, {
        region: null,
      }),
    ).toEqual({
      options: {},
      clearOptionKeys: ["region"],
    });
  });
});
