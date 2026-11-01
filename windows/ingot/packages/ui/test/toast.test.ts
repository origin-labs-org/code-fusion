import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  upsertToastItem,
  resolveToastAnchorLeft,
  ToastMessageView,
} from "@/components/ui/toast.js";

describe("toast", () => {
  it("同OneTarget与动作替换OldMessages，不同Messages保持最New在底部", () => {
    const first = {
      id: 1,
      message: "Provider A Save成功",
      durationMs: 3000,
      position: "bottom-left" as const,
      dedupeKey: "provider-save:provider-a",
    };
    const second = {
      id: 2,
      message: "model-a Connected successfully",
      durationMs: 3000,
      position: "bottom-left" as const,
      dedupeKey: "model-test:provider-a:model-a",
    };
    const replacement = { ...first, id: 3, message: "Provider A 再次Save成功" };

    expect(upsertToastItem(upsertToastItem([], first), second)).toEqual([first, second]);
    expect(upsertToastItem([first, second], replacement)).toEqual([second, replacement]);
  });

  it("centers an anchored toast within its region", () => {
    expect(resolveToastAnchorLeft({ left: 280, width: 960 })).toBe(760);
  });

  it("renders update toast content and an action", () => {
    const html = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item: {
          id: 1,
          message: "Feedback有New reply\nModel切换报Wrong有New的ProcessingReply，可View details。",
          durationMs: 7000,
          position: "bottom-left",
          variant: "update",
          actionLabel: "查看",
          onAction: vi.fn(),
        },
        visible: true,
        isBottom: true,
      }),
    );

    expect(html).toContain("Feedback有New reply");
    expect(html).toContain("查看");
  });

  it("renders Source Server update copy and an accessible dismiss action", () => {
    const html = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item: {
          id: 6,
          message: "linux-amd64-dev 必须更New后才能Connect\nCurrent 3.8.1，需要 3.9.0。",
          durationMs: 8000,
          position: "top-center",
          variant: "source-server-update",
          actionLabel: "立即更New",
          onAction: vi.fn(),
          dismissible: true,
          dismissLabel: "关闭",
        },
        visible: true,
        onDismiss: vi.fn(),
      }),
    );

    expect(html).toContain("linux-amd64-dev 必须更New后才能Connect");
    expect(html).toContain("Current 3.8.1，需要 3.9.0。");
    expect(html).toContain("立即更New");
    expect(html).toContain('aria-label="关闭"');
  });

  it("renders a dismissible actionable info toast for subscription guidance", () => {
    const html = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item: {
          id: 3,
          message: "Idle-time tasks are available for Coding Plan subscribers only.",
          durationMs: 8000,
          position: "top-right",
          variant: "info",
          actionLabel: "Upgrade",
          onAction: vi.fn(),
          dismissible: true,
        },
        visible: true,
        onDismiss: vi.fn(),
      }),
    );

    expect(html).toContain("Coding Plan subscribers only");
    expect(html).toContain("Upgrade");
    expect(html).toContain('aria-label="Close"');
  });

  it("renders multiline notice copy with its action", () => {
    const html = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item: {
          id: 4,
          message: "Document Skills\nPlugins未Install",
          durationMs: 5000,
          position: "top-right",
          variant: "info",
          actionLabel: "One键Install",
          onAction: vi.fn(),
        },
        visible: true,
      }),
    );

    expect(html).toContain("文档技能");
    expect(html).toContain("Plugins未Install");
    expect(html).toContain("One键Install");
  });

  it("moves top-right toasts from right to left with reduced-motion fallback", () => {
    const item = {
      id: 5,
      message: "Idle-time tasks are available for Coding Plan subscribers only.",
      durationMs: 8000,
      position: "top-right" as const,
      variant: "info" as const,
    };
    const hiddenHtml = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item,
        visible: false,
      }),
    );
    const visibleHtml = renderToStaticMarkup(
      createElement(ToastMessageView, {
        item,
        visible: true,
      }),
    );

    expect(hiddenHtml).toContain("transition-[transform,opacity]");
    expect(hiddenHtml).toContain("duration-200");
    expect(hiddenHtml).toContain("ease-[cubic-bezier(0.77,0,0.175,1)]");
    expect(hiddenHtml).toContain("translate-x-[calc(100%+1rem)]");
    expect(hiddenHtml).toContain("opacity-0");
    expect(hiddenHtml).toContain("motion-reduce:transform-none");
    expect(visibleHtml).toContain("translate-x-0");
    expect(visibleHtml).toContain("opacity-100");
    expect(visibleHtml).not.toContain("-translate-y-1");
  });
});
