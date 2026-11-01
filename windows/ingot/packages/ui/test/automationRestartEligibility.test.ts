import { describe, expect, it } from "vitest";
import {
  canRestartAutomation,
  canToggleAutomation,
  getAutomationActionErrorToastId,
  getAutomationCreateErrorToastId,
  getAutomationRunNowToastId,
  resolveAutomationDetailNavigation,
  resolveAutomationTabNavigation,
  resolveAutomationDetailTarget,
  resolveAutomationTemplateVisibility,
  resolveAutomationTabAfterOffPeakChange,
  resolveVisibleAutomationTabs,
} from "@/settings/AutomationsSection.js";

describe("canRestartAutomation", () => {
  it("只允许 failed 定时任务展示重启入口", () => {
    expect(canRestartAutomation({ lifecycleStatus: "failed" })).toBe(true);
    expect(canRestartAutomation({ lifecycleStatus: "completed" })).toBe(false);
    expect(canRestartAutomation({ lifecycleStatus: "active" })).toBe(false);
    expect(canRestartAutomation({ lifecycleStatus: "paused" })).toBe(false);
  });

  it("Do not show pause or resume entry points for completed and failed terminal states", () => {
    expect(canToggleAutomation({ lifecycleStatus: "active" })).toBe(true);
    expect(canToggleAutomation({ lifecycleStatus: "paused" })).toBe(true);
    expect(canToggleAutomation({ lifecycleStatus: "completed" })).toBe(false);
    expect(canToggleAutomation({ lifecycleStatus: "failed" })).toBe(false);
  });

  it("Duplicate run-now requests map to a running notice", () => {
    expect(getAutomationRunNowToastId("queued")).toBe("automations.runNowQueued");
    expect(getAutomationRunNowToastId("duplicate")).toBe("automations.runNowAlreadyRunning");
    expect(getAutomationRunNowToastId("failed")).toBe("automations.runNowFailed");
  });

  it("管理操作失败映射为产品文案，不直接展示 RPC 原文", () => {
    expect(getAutomationActionErrorToastId("create")).toBe("automations.error.create");
    expect(getAutomationActionErrorToastId("update")).toBe("automations.error.update");
    expect(getAutomationActionErrorToastId("toggle")).toBe("automations.error.toggle");
    expect(getAutomationActionErrorToastId("restart")).toBe("automations.error.restart");
    expect(getAutomationActionErrorToastId("delete")).toBe("automations.error.delete");
    expect(
      getAutomationCreateErrorToastId("[AUTOMATION_CREATE_LIMIT_REACHED] automation limit reached"),
    ).toBe("automations.error.createLimit");
    expect(getAutomationCreateErrorToastId("rpc unavailable")).toBe("automations.error.create");
  });

  it("Conversation creation card locates corresponding details by automationId", () => {
    const target = { automationId: "automation-target" } as never;
    const other = { automationId: "automation-other" } as never;

    expect(resolveAutomationDetailTarget([other, target], " automation-target ")).toBe(target);
    expect(resolveAutomationDetailTarget([other], "automation-target")).toBeNull();
    expect(resolveAutomationDetailTarget([target], undefined)).toBeNull();
  });

  it("Detail navigation waits for list completion and enters a consumable failure terminal state if the target does not exist", () => {
    const target = { automationId: "automation-target" } as never;

    expect(resolveAutomationDetailNavigation([], "automation-target", false)).toEqual({
      status: "pending",
    });
    expect(resolveAutomationDetailNavigation([target], "automation-target", true)).toEqual({
      status: "found",
      target,
    });
    expect(resolveAutomationDetailNavigation([], "automation-target", true)).toEqual({
      status: "missing",
    });
  });

  it("Keep only the Scheduled tab after disabling idle grayscale in the background", () => {
    expect(
      resolveVisibleAutomationTabs({
        hasAnyTasks: true,
        offPeakVisible: false,
      }),
    ).toEqual(["scheduled"]);
  });

  it("Show the Idle tab only when idle grayscale is visible or existing idle tasks exist", () => {
    expect(
      resolveVisibleAutomationTabs({
        hasAnyTasks: true,
        offPeakVisible: true,
      }),
    ).toEqual(["scheduled", "idle"]);
    expect(
      resolveVisibleAutomationTabs({
        hasAnyTasks: false,
        offPeakVisible: true,
      }),
    ).toEqual([]);
  });

  it("Collapse selected Idle tab back to Scheduled when grayscale is disabled", () => {
    expect(resolveAutomationTabAfterOffPeakChange("idle", false)).toBe("scheduled");
    expect(resolveAutomationTabAfterOffPeakChange("scheduled", false)).toBe("scheduled");
    expect(resolveAutomationTabAfterOffPeakChange("idle", true)).toBe("idle");
  });

  it("Apply OFFPEAK navigation only when tabs data is ready and Idle tab is visible", () => {
    expect(
      resolveAutomationTabNavigation({
        requestedTab: "idle",
        tabsReady: false,
        visibleTabs: [],
      }),
    ).toEqual({ status: "pending" });
    expect(
      resolveAutomationTabNavigation({
        requestedTab: "idle",
        tabsReady: true,
        visibleTabs: ["scheduled", "idle"],
      }),
    ).toEqual({ status: "settled", tab: "idle" });
    expect(
      resolveAutomationTabNavigation({
        requestedTab: "idle",
        tabsReady: true,
        visibleTabs: ["scheduled"],
      }),
    ).toEqual({ status: "settled", tab: "scheduled" });
  });

  it("Show available idle templates and scheduled task templates simultaneously when there are no tasks", () => {
    expect(
      resolveAutomationTemplateVisibility({
        hasAnyTasks: false,
        offPeakCreationEnabled: true,
        tab: "scheduled",
      }),
    ).toEqual({
      showOffPeakTemplates: true,
      showScheduledTemplates: true,
    });
    expect(
      resolveAutomationTemplateVisibility({
        hasAnyTasks: false,
        offPeakCreationEnabled: true,
        tab: "idle",
      }),
    ).toEqual({
      showOffPeakTemplates: true,
      showScheduledTemplates: true,
    });
    expect(
      resolveAutomationTemplateVisibility({
        hasAnyTasks: false,
        offPeakCreationEnabled: false,
        tab: "scheduled",
      }),
    ).toEqual({
      showOffPeakTemplates: false,
      showScheduledTemplates: true,
    });
  });

  it("有任务时继续按 Scheduled 和 Idle tab 分流模板", () => {
    expect(
      resolveAutomationTemplateVisibility({
        hasAnyTasks: true,
        offPeakCreationEnabled: true,
        tab: "scheduled",
      }),
    ).toEqual({
      showOffPeakTemplates: false,
      showScheduledTemplates: true,
    });
    expect(
      resolveAutomationTemplateVisibility({
        hasAnyTasks: true,
        offPeakCreationEnabled: true,
        tab: "idle",
      }),
    ).toEqual({
      showOffPeakTemplates: true,
      showScheduledTemplates: false,
    });
  });
});
