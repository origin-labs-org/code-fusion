import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { PendingCommandRecoveryBanner } from "@/v4/PendingCommandRecoveryBanner.js";
import type { PendingCommandEntry } from "@/v4/pendingCommandRegistry.js";

function render(entry: PendingCommandEntry): string {
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(PendingCommandRecoveryBanner, {
        entry,
        onResend: entry.replay.kind === "input" ? vi.fn() : undefined,
        onDismiss: vi.fn(),
      }),
    ),
  );
}

describe("PendingCommandRecoveryBanner", () => {
  it("discarded Plain input提供显式重NewSend按钮", () => {
    const html = render({
      commandId: "command-1",
      clientId: "client-1",
      sessionId: "session-1",
      issuedAt: 1,
      expiresAt: 2,
      recovery: "discarded",
      replay: { kind: "input", type: "sendText", payload: { text: "hello" } },
    });
    expect(html).toContain("CLI 重启前Submitted的输入没有进入对话");
    expect(html).toContain("重NewSend");
  });
});
