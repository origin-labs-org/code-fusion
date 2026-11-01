import { describe, expect, it } from "vitest";
import {
  EMPTY_FORM,
  formToConfig,
  jsonDraftToForm,
  serverToForm,
} from "@/settings/mcpSettingsShared.js";
import type { CfMcpServer } from "@origin-ai/cf-shared";

describe("mcp settings shared protocolVersion round-trip", () => {
  it("preserves a configured protocolVersion across serverToForm -> formToConfig", () => {
    const server: CfMcpServer = {
      config: { protocolVersion: "legacy", type: "http", url: "https://mcp.example.com/mcp" },
      name: "feishu",
      scope: "user",
    } as CfMcpServer;
    const form = serverToForm(server);
    expect(form.protocolVersion).toBe("legacy");
    expect(formToConfig(form)).toMatchObject({ protocolVersion: "legacy", type: "http" });
  });

  it("omits protocolVersion from the config when the form leaves it unset (auto)", () => {
    const form = { ...EMPTY_FORM, type: "http" as const, url: "https://mcp.example.com/mcp" };
    expect("protocolVersion" in formToConfig(form)).toBe(false);
  });

  it("preserves protocolVersion when a JSON draft is converted back to the form", () => {
    const form = jsonDraftToForm(
      JSON.stringify({
        feishu: { protocolVersion: "2026-07-28", type: "http", url: "https://mcp.example.com/mcp" },
      }),
      EMPTY_FORM,
    );
    expect(form.protocolVersion).toBe("2026-07-28");
  });

  it("normalizes an invalid protocolVersion to unset instead of surfacing it in the form", () => {
    const server = {
      config: { protocolVersion: "invalid", type: "http", url: "https://mcp.example.com/mcp" },
      name: "feishu",
      scope: "user",
    } as unknown as CfMcpServer;
    expect(serverToForm(server).protocolVersion).toBe("");

    const draft = jsonDraftToForm(
      JSON.stringify({
        feishu: { protocolVersion: 42, type: "http", url: "https://mcp.example.com/mcp" },
      }),
      EMPTY_FORM,
    );
    expect(draft.protocolVersion).toBe("");
  });
});
