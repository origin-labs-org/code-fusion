// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDynamicWorkflowUserMode,
  createDynamicWorkflowClientConfig,
  TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";
import {
  buildDynamicWorkflowModePatch,
  DynamicWorkflowModeSetting,
  resolveDynamicWorkflowModeSettingView,
} from "@/settings/DynamicWorkflowModeSetting.js";
import {
  resetDynamicWorkflowAvailabilityStoreForTests,
  useDynamicWorkflowAvailabilityStore,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

const mocks = vi.hoisted(() => ({
  update: vi.fn(async (_patch: unknown) => undefined),
  toast: vi.fn(),
  onValueChange: undefined as ((value: string) => void) | undefined,
}));

vi.mock("@/hooks/useSettingService.js", () => ({
  useSettings: () => ({ settings: {}, update: mocks.update }),
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: mocks.toast }));
vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/components/ui/select.js", () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => {
    mocks.onValueChange = onValueChange;
    return createElement("div", { "data-value": value, "data-testid": "select" }, children);
  },
  SelectTrigger: ({ children, ...props }: { children: ReactNode }) =>
    createElement("button", props, children),
  SelectValue: () => createElement("span"),
  SelectContent: ({
    children,
    position,
    className,
  }: {
    children: ReactNode;
    position?: string;
    className?: string;
  }) => createElement("div", { "data-position": position, className }, children),
  SelectRichItem: ({
    value,
    title,
    titleAdornment,
    description,
  }: {
    value: string;
    title: ReactNode;
    titleAdornment?: ReactNode;
    description?: ReactNode;
  }) =>
    createElement(
      "div",
      { "data-testid": `option-${value}` },
      createElement("span", { "data-part": "title" }, title),
      titleAdornment ? createElement("span", { "data-part": "tag" }, titleAdornment) : null,
      createElement("span", { "data-part": "description" }, description),
    ),
}));

function publish(offered: DynamicWorkflowMode, userMode?: DynamicWorkflowMode) {
  const config = applyDynamicWorkflowUserMode(
    createDynamicWorkflowClientConfig(offered, "remote"),
    userMode,
  );
  useDynamicWorkflowAvailabilityStore.setState({
    status: "ready",
    enabled: config.enabled,
    config,
  });
}

function taggedOptions(): string[] {
  return (["disabled", "onDemand", "alwaysOn"] as const).filter(
    (mode) => screen.getByTestId(`option-${mode}`).querySelector('[data-part="tag"]') !== null,
  );
}

describe("DynamicWorkflowModeSetting（DWG-22）", () => {
  beforeEach(() => {
    mocks.update.mockReset();
    mocks.update.mockResolvedValue(undefined);
    mocks.toast.mockReset();
    mocks.onValueChange = undefined;
  });
  afterEach(() => {
    cleanup();
    resetDynamicWorkflowAvailabilityStoreForTests();
  });

  it("Do not render entire row when snapshot is loading or failed to read", () => {
    const { container, rerender } = render(createElement(DynamicWorkflowModeSetting));
    expect(container.innerHTML).toBe("");

    act(() =>
      useDynamicWorkflowAvailabilityStore.setState({
        status: "ready",
        enabled: false,
        config: null,
      }),
    );
    rerender(createElement(DynamicWorkflowModeSetting));
    expect(container.innerHTML).toBe("");
  });

  it("Row still appears when server defaults to disabled: shows \"Off\" with \"Default\" on it; selecting on writes this mode", async () => {
    act(() => publish("disabled"));
    render(createElement(DynamicWorkflowModeSetting));
    expect(screen.getByTestId("select").getAttribute("data-value")).toBe("disabled");
    expect(taggedOptions()).toEqual(["disabled"]);

    await act(async () => mocks.onValueChange?.("alwaysOn"));
    expect(mocks.update).toHaveBeenLastCalledWith({ dynamicWorkflowMode: "alwaysOn" });
    act(() => publish("disabled", "alwaysOn"));
    expect(screen.getByTestId("select").getAttribute("data-value")).toBe("alwaysOn");
    expect(taggedOptions()).toEqual(["disabled"]);
  });

  it("Displays server-provided mode when unselected, with default badge only on it", () => {
    act(() => publish("alwaysOn"));
    render(createElement(DynamicWorkflowModeSetting));
    expect(screen.getByTestId("select").getAttribute("data-value")).toBe("alwaysOn");
    expect(taggedOptions()).toEqual(["alwaysOn"]);
    expect(screen.getByTestId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER)).toBeTruthy();
    expect(
      screen.getByTestId("option-onDemand").querySelector('[data-part="description"]')?.textContent,
    ).toBe("settings.dynamicWorkflow.option.onDemand.description");
  });

  it("Displays effective value when user selection takes effect; badge remains on server-provided mode", () => {
    act(() => publish("alwaysOn", "disabled"));
    render(createElement(DynamicWorkflowModeSetting));
    expect(screen.getByTestId("select").getAttribute("data-value")).toBe("disabled");
    expect(taggedOptions()).toEqual(["alwaysOn"]);
  });

  it("Selecting other modes writes that mode; selecting back to default writes empty string to clear; shows selected value before Host returns", async () => {
    act(() => publish("alwaysOn"));
    render(createElement(DynamicWorkflowModeSetting));

    await act(async () => mocks.onValueChange?.("onDemand"));
    expect(mocks.update).toHaveBeenLastCalledWith({ dynamicWorkflowMode: "onDemand" });
    expect(screen.getByTestId("select").getAttribute("data-value")).toBe("onDemand");

    act(() => publish("alwaysOn", "onDemand"));
    await act(async () => mocks.onValueChange?.("alwaysOn"));
    expect(mocks.update).toHaveBeenLastCalledWith({ dynamicWorkflowMode: "" });
  });

  it("Write failed: revert to value in Host snapshot and show notification", async () => {
    mocks.update.mockRejectedValueOnce(new Error("disk full"));
    act(() => publish("onDemand"));
    render(createElement(DynamicWorkflowModeSetting));

    await act(async () => mocks.onValueChange?.("disabled"));
    await waitFor(() =>
      expect(screen.getByTestId("select").getAttribute("data-value")).toBe("onDemand"),
    );
    expect(mocks.toast).toHaveBeenCalledWith("settings.dynamicWorkflow.saveError");
  });

  it("Pure function: view and patch", () => {
    expect(
      resolveDynamicWorkflowModeSettingView({ status: "loading", enabled: false, config: null }),
    ).toBeNull();
    const config = applyDynamicWorkflowUserMode(
      createDynamicWorkflowClientConfig("onDemand", "override"),
      "alwaysOn",
    );
    expect(
      resolveDynamicWorkflowModeSettingView({ status: "ready", enabled: true, config }),
    ).toEqual({ value: "alwaysOn", offeredMode: "onDemand" });
    const legacy = {
      mode: "alwaysOn",
      enabled: true,
      source: "remote",
    } as unknown as typeof config;
    expect(
      resolveDynamicWorkflowModeSettingView({ status: "ready", enabled: true, config: legacy }),
    ).toBeNull();
    expect(buildDynamicWorkflowModePatch("onDemand", "onDemand")).toEqual({
      dynamicWorkflowMode: "",
    });
    expect(buildDynamicWorkflowModePatch("disabled", "onDemand")).toEqual({
      dynamicWorkflowMode: "disabled",
    });
  });
});
