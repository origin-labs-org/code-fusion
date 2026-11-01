// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PluginUninstallConfirmDialog } from "@/settings/PluginUninstallConfirmDialog.js";
import { StorageCleanConfirmDialog } from "@/resource-manager/storage/StorageCleanConfirmDialog.js";
import { ConfirmDialogHost } from "@/ConfirmDialog.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));

afterEach(() => {
  cleanup();
  useConfirmDialogStore.getState().settleConfirmation(false);
});

describe("破坏性确认键盘防护", () => {
  it.each([undefined, "automation-confirmation"] as const)(
    "%s defaults focus to Cancel; Enter cannot confirm, explicit click required",
    async (presentation) => {
      render(createElement(ConfirmDialogHost));
      let result!: Promise<boolean>;
      act(() => {
        result = useConfirmDialogStore.getState().requestConfirmation({
          title: "删除",
          description: "删除操作不可恢复",
          presentation,
          confirmVariant: "destructive",
          confirmLabel: "删除",
          cancelLabel: "取消",
        });
      });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: /cancel/ }));
      fireEvent.keyDown(document.activeElement!, { key: "Enter" });
      expect(useConfirmDialogStore.getState().pendingRequest).toBeDefined();
      fireEvent.click(screen.getByRole("button", { name: "删除" }));
      await expect(result).resolves.toBe(true);
    },
  );

  it.each(["plugin", "storage"] as const)("%s standalone destructive dialog also defaults focus to Cancel", (kind) => {
    const confirm = vi.fn();
    render(
      kind === "plugin"
        ? createElement(PluginUninstallConfirmDialog, {
            open: true,
            pluginName: "test",
            pending: false,
            onCancel: vi.fn(),
            onConfirm: confirm,
          })
        : createElement(StorageCleanConfirmDialog, {
            target: { categoryId: "logs", bytes: 1024 },
            pending: false,
            onCancel: vi.fn(),
            onConfirm: confirm,
          }),
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "common.cancel" }));
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("Normal confirmation retains the Enter shortcut", async () => {
    render(createElement(ConfirmDialogHost));
    let result!: Promise<boolean>;
    act(() => {
      result = useConfirmDialogStore
        .getState()
        .requestConfirmation({ title: "连接", description: "连接设备" });
    });
    fireEvent.keyDown(window, { key: "Enter" });
    await expect(result).resolves.toBe(true);
  });
});
