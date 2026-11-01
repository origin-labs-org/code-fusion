import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, LoaderIcon } from "lucide-react";
import { type WebRemoteControlMobileNavigationIntent } from "@origin-ai/cf-shared";
import { Button } from "@/components/ui/button.js";
import { WebRemoteControlThemeMenu } from "@/WebRemoteControlThemeMenu.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { WebRemoteControlTaskViewReporter } from "@/web-remote-control/index.js";
import type { WebRemoteControlTerminalTransportState } from "@/root/types.js";
import type { WebRemoteControlWorkspaceSwitcherApi } from "@/root/types.js";
import { useWebRemoteControlTerminalTransportState } from "@/webRemoteControlTerminalTransportState.js";

type WebRemoteControlMobilePage = "home" | "chat";

interface WebRemoteControlMobileHistoryState {
  cfMobilePage?: WebRemoteControlMobilePage;
}

export function isWebRemoteControlMobileChatHistoryState(
  state: unknown,
): state is WebRemoteControlMobileHistoryState {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as WebRemoteControlMobileHistoryState).cfMobilePage === "chat"
  );
}

function pushWebRemoteControlMobileChatHistory() {
  if (typeof window === "undefined") {
    return;
  }

  if (isWebRemoteControlMobileChatHistoryState(window.history.state)) {
    return;
  }

  window.history.pushState({ cfMobilePage: "chat" }, "");
}

function resolveInitialWebRemoteControlMobilePage(
  initialNavigationIntent?: WebRemoteControlMobileNavigationIntent,
): WebRemoteControlMobilePage {
  if (initialNavigationIntent === "chat") {
    return "chat";
  }

  if (
    typeof window !== "undefined" &&
    isWebRemoteControlMobileChatHistoryState(window.history.state)
  ) {
    return "chat";
  }

  return "home";
}

export function WebRemoteControlMobileShell({
  children,
  isMobileViewport = true,
  activeTaskId,
  activeWorkspaceIdentity,
  activeWorkspacePath,
  taskViewEnabled = true,
  chatContent,
  chatOverlay,
  initialNavigationIntent,
  isSidePaneOpen = false,
  onCloseSidePane,
  renderTaskHome,
  renderChatHeader,
  sidePaneContent,
  switcher,
  webRemoteControlTerminalTransportState,
}: {
  children?: ReactNode;
  isMobileViewport?: boolean;
  switcher: WebRemoteControlWorkspaceSwitcherApi;
  activeWorkspacePath: string;
  activeWorkspaceIdentity?: string;
  activeTaskId: string | null;
  taskViewEnabled?: boolean;
  initialNavigationIntent?: WebRemoteControlMobileNavigationIntent;
  isSidePaneOpen?: boolean;
  onCloseSidePane?: () => void;
  renderTaskHome: (options: {
    navigateToChat(): void;
    setSwitching(switching: boolean): void;
  }) => ReactNode;
  renderChatHeader: (options: { onBackHome: () => void }) => ReactNode;
  chatContent: ReactNode;
  chatOverlay?: ReactNode;
  sidePaneContent?: ReactNode;
  webRemoteControlTerminalTransportState?: WebRemoteControlTerminalTransportState;
}) {
  const { intl } = useCfIntl();
  const [currentPage, setCurrentPage] = useState<WebRemoteControlMobilePage>(() =>
    resolveInitialWebRemoteControlMobilePage(initialNavigationIntent),
  );
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const terminalTransportState = useWebRemoteControlTerminalTransportState(
    webRemoteControlTerminalTransportState,
  );
  const shouldInertChatSurface = Boolean(sidePaneContent) && isSidePaneOpen;

  const navigateToChat = useCallback(() => {
    setCurrentPage("chat");
    pushWebRemoteControlMobileChatHistory();
  }, []);

  const navigateHome = useCallback(() => {
    if (
      typeof window !== "undefined" &&
      isWebRemoteControlMobileChatHistoryState(window.history.state)
    ) {
      window.history.back();
      return;
    }

    setCurrentPage("home");
  }, []);

  useEffect(() => {
    if (initialNavigationIntent === "chat") setCurrentPage("chat");
  }, [initialNavigationIntent]);

  useEffect(() => {
    if (isMobileViewport && currentPage === "chat") pushWebRemoteControlMobileChatHistory();
  }, [isMobileViewport, currentPage]);

  useEffect(() => {
    if (!isMobileViewport || typeof window === "undefined") {
      return;
    }

    const handlePopState = (event: PopStateEvent) => {
      const nextPage = isWebRemoteControlMobileChatHistoryState(event.state) ? "chat" : "home";
      setCurrentPage(nextPage);
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isMobileViewport]);

  return (
    <>
      <WebRemoteControlTaskViewReporter
        enabled={
          taskViewEnabled &&
          (!isMobileViewport ||
            (currentPage === "chat" && !shouldInertChatSurface && !switchingWorkspace))
        }
        activeTaskId={activeTaskId}
        workspacePath={activeWorkspacePath}
        workspaceIdentity={activeWorkspaceIdentity}
        switcher={switcher}
      />
      {isMobileViewport ? (
        <div className="relative flex h-full min-h-0 min-w-0 flex-col bg-background">
          {currentPage === "home" ? (
            <section className="flex h-full min-h-0 min-w-0 flex-col" data-mobile-page="home">
              {renderTaskHome({ navigateToChat, setSwitching: setSwitchingWorkspace })}
            </section>
          ) : (
            <section
              className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground"
              data-mobile-page="chat"
            >
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border bg-header px-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={intl.formatMessage({
                    id: "webRemoteControl.mobileShell.backHome",
                  })}
                  onClick={navigateHome}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <span className="min-w-0 flex-1 truncate text-ui-base font-medium">
                  {intl.formatMessage({ id: "webRemoteControl.mobileShell.chatTitle" })}
                </span>
                <WebRemoteControlThemeMenu />
              </div>
              {renderChatHeader({ onBackHome: navigateHome })}
              <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <main
                  className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  aria-hidden={shouldInertChatSurface ? true : undefined}
                  data-mobile-chat-surface={shouldInertChatSurface ? "inert" : undefined}
                  inert={shouldInertChatSurface ? true : undefined}
                >
                  {}
                  {chatContent}
                </main>
                {sidePaneContent ? (
                  <div
                    className={[
                      "absolute inset-0 z-30 transition-opacity duration-200 ease-out",
                      isSidePaneOpen ? "opacity-100" : "pointer-events-none opacity-0",
                    ].join(" ")}
                    aria-hidden={!isSidePaneOpen}
                    data-mobile-side-pane-overlay="true"
                  >
                    <button
                      type="button"
                      className="absolute inset-0 bg-background/60 backdrop-blur-[1px]"
                      aria-label={intl.formatMessage({ id: "sidePane.collapse" })}
                      onClick={onCloseSidePane}
                    />
                    <div
                      className={[
                        "absolute top-0 right-0 h-full w-[min(88vw,28rem)] max-w-full border-l border-border bg-background shadow-2xl transition-transform duration-200 ease-out",
                        isSidePaneOpen ? "translate-x-0" : "translate-x-full",
                      ].join(" ")}
                    >
                      {}
                      {sidePaneContent}
                    </div>
                  </div>
                ) : null}
                {chatOverlay ? (
                  <div
                    className="pointer-events-none absolute inset-0 z-40"
                    data-mobile-chat-overlay="true"
                  >
                    {}
                    <div className="pointer-events-auto">{chatOverlay}</div>
                  </div>
                ) : null}
              </div>
            </section>
          )}

          {switchingWorkspace ? (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center bg-background/72 backdrop-blur-[1px]"
              aria-live="polite"
              aria-busy="true"
            >
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-ui-base text-foreground-subtle shadow-sm">
                <LoaderIcon className="size-4 animate-spin" />
                {intl.formatMessage({ id: "common.loading" })}
              </div>
            </div>
          ) : null}
          {terminalTransportState === "reconnecting" ? (
            <div
              className="pointer-events-none absolute top-3 left-1/2 z-50 flex -translate-x-1/2 justify-center px-3"
              aria-live="polite"
              aria-busy="true"
              data-web-remote-control-reconnect-notice="true"
            >
              <div className="flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-lg border border-border bg-toast px-3 py-2 text-ui-base text-foreground shadow-lg">
                <LoaderIcon className="size-4 shrink-0 animate-spin text-foreground-subtle" />
                <span className="min-w-0 whitespace-nowrap">
                  {intl.formatMessage({ id: "webRemoteControl.mobileShell.reconnecting" })}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        children
      )}
    </>
  );
}
