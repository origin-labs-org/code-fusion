import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBigModelApiOrigin, resolveRuntimeCfEndpointOrigin } from "@origin-ai/cf-shared";
import {
  getE2EProviderEndpointEnv,
  shouldUseProductionE2EProviderEndpoint,
} from "#e2e/helpers/e2e-provider-endpoint";

const requestSecurityEnv = vi.hoisted(() => ({ current: {} as Record<string, string> }));
vi.mock("#e2e/helpers/request-security-edition/index", () => ({
  requestSecurityEndpointEnv: () => requestSecurityEnv.current,
}));

const liveTeam = "conversation-session-r3-live-bigmodel-team.test.ts";
const ordinary = "conversation-session-v4-sendnow.test.ts";
const liveShare = "conversation-session-share-ssh-artifact.test.ts";

afterEach(() => {
  requestSecurityEnv.current = {};
});

describe("E2E provider endpoint ownership", () => {
  it.each([liveTeam, liveShare])("Production accounts use a unified production environment transferable via SSH: %s", (spec) => {
    const env = {
      CF_ENV: "test",
      ...getE2EProviderEndpointEnv([spec], "deepseek", "replay"),
    };
    expect(resolveRuntimeCfEndpointOrigin(env)).toBe("https://cf.z.ai");
    expect(resolveBigModelApiOrigin(env)).toBe("https://bigmodel.cn");
    expect(env.CF_ENV).toBe("production");
    expect(resolveBigModelApiOrigin({ CF_ENV: env.CF_ENV })).toBe("https://bigmodel.cn");
  });

  it("Control plane overrides for standard test cases come directly from request security implementation; they do not receive real Team BigModel interface overrides", () => {
    expect(getE2EProviderEndpointEnv([ordinary], "deepseek", "replay")).toEqual({});
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "deepseek", "replay")).toBe(false);

    requestSecurityEnv.current = { CF_BASE_URL: "https://config.example.com" };
    expect(getE2EProviderEndpointEnv([ordinary], "example-preset", "capture")).toEqual({
      CF_BASE_URL: "https://config.example.com",
    });
    expect(shouldUseProductionE2EProviderEndpoint([ordinary], "example-preset", "capture")).toBe(
      true,
    );
  });
  it("SSH share real accounts and share APIs use the same production environment", () => {
    expect(shouldUseProductionE2EProviderEndpoint([liveShare], "deepseek", "replay")).toBe(true);
  });

  it.each([
    [liveShare, ordinary],
    [liveShare, liveTeam],
  ])("Real shares must run independently: %j", (...specs) => {
    expect(() => shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toThrow(
      "独立运行",
    );
  });
  it.each([
    liveTeam,
    `/repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `file:///repo/packages/desktop/test/e2e/conversation-session/manual-review/pending/${liveTeam}`,
    `C:\\repo\\packages\\desktop\\test\\e2e\\${liveTeam}`,
  ])("Independent live-teams for production account materials use the production control plane: %s", (spec) => {
    expect(shouldUseProductionE2EProviderEndpoint([spec], "deepseek", "replay")).toBe(true);
  });

  it.each([{ specs: [] }, { specs: ["conversation-session-r3-live-zapi.test.ts"] }])(
    "普通或 ZAPI 用例不获得生产账号控制面例外：$specs",
    ({ specs }) => {
      expect(shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toBe(false);
    },
  );

  it.each([
    [liveTeam, ordinary],
    [ordinary, liveTeam],
  ])("Refuse to mix live-teams with other specs: %j", (...specs) => {
    expect(() => shouldUseProductionE2EProviderEndpoint(specs, "deepseek", "replay")).toThrow(
      "live-team 必须独立运行",
    );
  });
});
