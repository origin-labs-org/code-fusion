import { describe, expect, it } from "vitest";
import { updateDynamicWorkflowPolicy } from "../src/cf-protocol/dynamic-workflow-policy.js";
import type { CfProtocolAgentServerContext } from "../src/cf-protocol/server-types.js";
import { CfProtocolAgentServer } from "../src/cf-protocol/server.js";
import { closeSession, createSessionRecordForV4 } from "../src/cf-protocol/server-operations.js";
import { listProtocolSlashCommands } from "../src/cf-protocol/slash-commands.js";
import type { CfAppOptions } from "../src/app/types.js";
import { createFakeApp } from "./helpers/fake-cf-app.js";

const workspace = { workspaceKey: "/w", workspacePath: "/w" };

function makeContext() {
  return {
    appRuntimePreferences: {
      askUserQuestionAutoResolutionEnabled: true,
      modelIoFullRetentionEnabled: false,
      offPeakToolEnabled: false,
      dynamicWorkflowEnabled: false,
    },
  } as unknown as CfProtocolAgentServerContext;
}

describe("workspace/updateDynamicWorkflowPolicy（灰度门 workspace 级事实）", () => {
  it("缓存 host 判定供后续 create/resume/v4 冷恢复读取，并回显结果", async () => {
    const context = makeContext();
    const result = await updateDynamicWorkflowPolicy(context, { workspace, enabled: true });
    expect(context.appRuntimePreferences.dynamicWorkflowEnabled).toBe(true);
    expect(result).toEqual({ workspace, enabled: true });

    await updateDynamicWorkflowPolicy(context, { workspace, enabled: false });
    expect(context.appRuntimePreferences.dynamicWorkflowEnabled).toBe(false);
  });

  it("mode 随布尔缓存；关闭时清空，免得旧 Host 只发布尔时沿用过期的 onDemand", async () => {
    const context = makeContext();
    await updateDynamicWorkflowPolicy(context, { workspace, enabled: true, mode: "onDemand" });
    expect(context.appRuntimePreferences.dynamicWorkflowMode).toBe("onDemand");
    await updateDynamicWorkflowPolicy(context, { workspace, enabled: false, mode: "onDemand" });
    expect(context.appRuntimePreferences.dynamicWorkflowMode).toBeUndefined();
    await updateDynamicWorkflowPolicy(context, { workspace, enabled: true });
    expect(context.appRuntimePreferences.dynamicWorkflowMode).toBeUndefined();
  });

  it("mode 只认三个取值", async () => {
    await expect(
      updateDynamicWorkflowPolicy(makeContext(), { workspace, enabled: true, mode: "sometimes" }),
    ).rejects.toThrow();
  });

  it("strict schema 拒绝未知键（不让 host 误传 per-session 字段）", async () => {
    await expect(
      updateDynamicWorkflowPolicy(makeContext(), { workspace, enabled: true, sessionId: "s1" }),
    ).rejects.toThrow();
  });
});

describe("session 创建：runtimeConfig.dynamicWorkflowEnabled", () => {
  async function createdRuntimeGate(params: {
    dynamicWorkflowEnabled?: boolean;
    dynamicWorkflowMode?: "disabled" | "onDemand" | "alwaysOn";
    preference?: boolean;
    preferenceMode?: "disabled" | "onDemand" | "alwaysOn";
  }): Promise<{ enabled: boolean | undefined; onDemand: boolean | undefined }> {
    let appOptions: CfAppOptions | undefined;
    const server = new CfProtocolAgentServer({
      createCfApp: (options) => {
        appOptions = options;
        return createFakeApp(options);
      },
    });
    const context = (server as unknown as { context: CfProtocolAgentServerContext }).context;
    if (params.preference !== undefined) {
      await updateDynamicWorkflowPolicy(context, {
        workspace,
        enabled: params.preference,
        ...(params.preferenceMode === undefined ? {} : { mode: params.preferenceMode }),
      });
    }
    const created = await createSessionRecordForV4(context, {
      workspace: { workspacePath: "/fixture", workspaceKey: "/fixture" },
      ...(params.dynamicWorkflowEnabled === undefined
        ? {}
        : { dynamicWorkflowEnabled: params.dynamicWorkflowEnabled }),
      ...(params.dynamicWorkflowMode === undefined
        ? {}
        : { dynamicWorkflowMode: params.dynamicWorkflowMode }),
    });
    try {
      return {
        enabled: appOptions?.runtimeConfig?.dynamicWorkflowEnabled,
        onDemand: appOptions?.runtimeConfig?.dynamicWorkflowToolsOnDemand,
      };
    } finally {
      await closeSession(context, { sessionId: created.sessionId });
    }
  }

  it.each([
    { params: { preference: true }, expected: true },
    { params: { dynamicWorkflowEnabled: true, preference: false }, expected: true },
    { params: { dynamicWorkflowEnabled: false, preference: true }, expected: true },
  ])("%j", async ({ params, expected }) => {
    await expect(createdRuntimeGate(params)).resolves.toMatchObject({ enabled: expected });
  });

  it.each([
    { params: {}, expected: { enabled: false, onDemand: false } },
    { params: { dynamicWorkflowEnabled: true }, expected: { enabled: true, onDemand: false } },
    {
      params: { dynamicWorkflowEnabled: true, dynamicWorkflowMode: "onDemand" as const },
      expected: { enabled: true, onDemand: true },
    },
    {
      params: { dynamicWorkflowEnabled: true, dynamicWorkflowMode: "alwaysOn" as const },
      expected: { enabled: true, onDemand: false },
    },
    {
      params: { preference: true, preferenceMode: "onDemand" as const },
      expected: { enabled: true, onDemand: true },
    },
    {
      params: {
        dynamicWorkflowEnabled: true,
        preference: true,
        preferenceMode: "onDemand" as const,
      },
      expected: { enabled: true, onDemand: true },
    },
    {
      params: {
        dynamicWorkflowEnabled: true,
        dynamicWorkflowMode: "alwaysOn" as const,
        preference: true,
        preferenceMode: "onDemand" as const,
      },
      expected: { enabled: true, onDemand: false },
    },
    {
      params: { dynamicWorkflowMode: "onDemand" as const },
      expected: { enabled: false, onDemand: false },
    },
  ])("mode 推导 %j", async ({ params, expected }) => {
    await expect(createdRuntimeGate(params)).resolves.toEqual(expected);
  });
});

describe("`/` 目录：灰度关闭时没有 workflow", () => {
  it("关闭剔除、开启保留并紧随 goal 之后（内置命令，不依赖任何插件）", async () => {
    const options = {
      env: { CF_ENV: "test" },
      skipUserConfig: true,
      workingDirectory: process.cwd(),
    };
    const disabled = await listProtocolSlashCommands({
      ...options,
      dynamicWorkflowEnabled: false,
    });
    expect(disabled.some((command) => command.name === "workflow")).toBe(false);
    expect(disabled.some((command) => command.name === "goal")).toBe(true);

    const enabled = await listProtocolSlashCommands({
      ...options,
      dynamicWorkflowEnabled: true,
    });
    const names = enabled.map((command) => command.name);
    expect(names.indexOf("workflow")).toBe(names.indexOf("goal") + 1);
    expect(enabled.find((command) => command.name === "workflow")?.source).toBe("builtin");
  });
});
