import type { IPlatformService } from "@origin-ai/cf-shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatErrorBanner } from "@/ChatErrorBanner.js";
import { useFeedbackStore } from "@/feedback/feedbackStore.js";
import { PlatformProvider } from "@/hooks/usePlatform.js";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import zhCN from "@/i18n/locales/zh-CN.js";

const buttonMock = vi.hoisted(() => ({
  props: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/ui/button.js", async () => {
  const React = await import("react");
  return {
    Button: (props: Record<string, unknown>) => {
      buttonMock.props.push(props);
      const { children, size, variant, ...domProps } = props;
      void size;
      void variant;
      return React.createElement("button", domProps, children);
    },
  };
});

vi.mock("@/components/ui/toast.js", () => ({
  toast: vi.fn(),
}));

const mockPlatform = {
  captureWindowScreenshot: vi.fn(async () => null),
} as unknown as IPlatformService;

function resetFeedbackStore() {
  useFeedbackStore.setState({
    open: false,
    featureRequestOpen: false,
    tab: "submit",
    submitDraft: null,
    selectedTicketId: null,
  });
}

function renderErrorBanner() {
  renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: mockPlatform },
        createElement(ChatErrorBanner, {
          error: {
            code: "PROVIDER_AUTH_FAILED",
            message: "Provider authentication failed.",
            traceId: "trace-auth-failed",
          },
          onDismiss: vi.fn(),
        }),
      ),
    ),
  );
}

async function openFeedbackFromBanner() {
  const feedbackButton = buttonMock.props.find((props) => props["aria-label"] === "Report Issue");
  expect(feedbackButton).toBeDefined();
  if (!feedbackButton) {
    throw new Error("Feedback issue button was not rendered");
  }

  (feedbackButton.onClick as () => void)();
  await Promise.resolve();
  await Promise.resolve();
}

describe("ChatErrorBanner feedback draft", () => {
  beforeEach(() => {
    buttonMock.props = [];
    vi.clearAllMocks();
    resetFeedbackStore();
  });

  it("uses a compact one-line error summary without the generic investigation heading", async () => {
    renderErrorBanner();

    await openFeedbackFromBanner();

    expect(mockPlatform.captureWindowScreenshot).not.toHaveBeenCalled();
    expect(useFeedbackStore.getState().submitDraft?.includeLogs).toBe(true);
    const description = useFeedbackStore.getState().submitDraft?.description;
    expect(description).toContain("Error Summary: Provider authentication failed.");
    expect(description).toContain("TraceID: trace-auth-failed");
    expect(description).not.toContain("我在使用过程中遇到了报错，请帮忙排查。");
    expect(description).not.toContain("报WrongSummary\nProvider authentication failed.");
  });

  it("Hides unavailable upgrade actions when no upgrade handler is present", () => {
    renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          PlatformProvider,
          { platform: mockPlatform },
          createElement(ChatErrorBanner, {
            error: {
              code: "model_config_missing",
              message: "Model config is missing.",
            },
            onOpenModelSettings: vi.fn(),
          }),
        ),
      ),
    );

    expect(buttonMock.props.some((props) => props["aria-label"] === "升级")).toBe(false);
    expect(buttonMock.props.some((props) => props["aria-label"] === "配置")).toBe(true);
  });

  it("Only changes wording when remote workspace lacks model; action remains local configuration and upgrade", () => {
    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(
          PlatformProvider,
          { platform: mockPlatform },
          createElement(ChatErrorBanner, {
            error: {
              code: "model_config_missing",
              message: "Model config is missing.",
            },
            modelConfigTarget: "remote",
            onOpenModelSettings: vi.fn(),
            onOpenUpgrade: vi.fn(),
          }),
        ),
      ),
    );

    expect(html).toContain(zhCN["chat.error.remoteNoAvailableModel"]);
    expect(html).not.toContain(zhCN["chat.error.noAvailableModel"]);
    expect(buttonMock.props.some((props) => props["aria-label"] === "配置")).toBe(true);
    expect(buttonMock.props.some((props) => props["aria-label"] === "升级")).toBe(true);
    expect(buttonMock.props.some((props) => props["aria-label"] === "Go to Sync")).toBe(false);
  });
});

it("Provides reconnect for remote send race; attributes feedback to connection failure rather than model call", async () => {
  const reconnect = vi.fn();
  renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "zh-CN" },
      createElement(
        PlatformProvider,
        { platform: mockPlatform },
        createElement(ChatErrorBanner, {
          error: {
            code: "CF_REMOTE_WORKSPACE_DISCONNECTED",
            message: "CF_REMOTE_WORKSPACE_DISCONNECTED",
          },
          remoteKind: "ssh",
          onReconnect: reconnect,
        }),
      ),
    ),
  );
  const button = buttonMock.props.find((props) => props.children === "重新连接");
  expect(button).toBeDefined();
  (button!.onClick as () => void)();
  expect(reconnect).toHaveBeenCalledOnce();
  await openFeedbackFromBanner();
  expect(useFeedbackStore.getState().submitDraft?.module).toBe("SSH Connection Failed");
});
