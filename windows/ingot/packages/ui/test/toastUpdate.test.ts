// @vitest-environment jsdom

import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast, updateToast } from "@/components/ui/toast.js";

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("toast updates", () => {
  it("updates an existing toast in place instead of stacking a second item", async () => {
    let id = toast("导入Status初始化", { durationMs: 0, dedupeKey: "share-import" });
    updateToast(id, { message: "In progress下载分享File：0/1", variant: "info" });
    await waitFor(() => {
      expect(document.querySelector("#cf-toast-host")?.textContent).toContain(
        "In progress下载分享File：0/1",
      );
    });

    id = toast("In progressCompleted导入", { durationMs: 0, dedupeKey: "share-import" });
    updateToast(id, { message: "Imported from share：ExampleSession", durationMs: 10 });
    await waitFor(() => {
      const hostText = document.querySelector("#cf-toast-host")?.textContent ?? "";
      expect(hostText).toContain("Imported from share：ExampleSession");
      expect(hostText).not.toContain("In progress下载分享File：0/1");
      expect(document.querySelectorAll("#cf-toast-host .rounded-2xl")).toHaveLength(1);
    });
    await waitFor(
      () => expect(document.querySelectorAll("#cf-toast-host .rounded-2xl")).toHaveLength(0),
      { timeout: 1000 },
    );
  });
});
