
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import { ClipboardPaste, Copy } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import type { ILink, ILinkHandler, ITheme, IWindowsPty } from "@xterm/xterm";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { IDisposable } from "@origin-ai/cf-rpc";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu.js";
import {
  createPendingTerminalInputFallback,
  consumeTerminalInputFallbackHandledData,
  createTerminalInputFallbackKeydownCandidate,
  markTerminalInputFallbackHandled,
  recordTerminalInputFallbackHandledData,
  recordTerminalInputFallbackRecentData,
  resolveTerminalInputFallbackAction,
  type PendingTerminalInputFallback,
  type TerminalInputFallbackKeydownCandidate,
  type TerminalInputFallbackHandledData,
} from "@/terminal/terminalComposedInputFallback.js";
import { normalizePowerShellReadlineRedraw } from "@/terminal/terminalDataTransform.js";
import { getHttpLinksForTerminalBufferLine } from "@/terminal/terminalLinks.js";
import { mergeTerminalTheme } from "@/terminal/terminalTheme.js";
import {
  sidePaneTerminalSessionRegistry,
  type SidePaneTerminalSessionEntry,
} from "@/terminal/sidePaneTerminalSessionRegistry.js";

const DEFAULT_TERMINAL_FONT_FAMILY =
  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Cascadia Mono', 'JetBrains Mono', 'MesloLGS NF', 'Hack Nerd Font', monospace";
const TERMINAL_RESIZE_DRAG_THROTTLE_MS = 300;
const TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS = 150;
const TERMINAL_INPUT_FALLBACK_KEYDOWN_INPUT_MS = 40;
const TERMINAL_INPUT_FALLBACK_FLUSH_DELAY_MS = 150;

type TerminalResizeReason = "drag" | "final" | "visible" | "init" | "observer";

type TerminalSize = {
  cols: number;
  rows: number;
};

function normalizeWindowsPtyOption(windowsPty: IWindowsPty | undefined): IWindowsPty | undefined {
  if (!windowsPty) return undefined;
  return windowsPty.buildNumber
    ? { backend: windowsPty.backend, buildNumber: windowsPty.buildNumber }
    : { backend: windowsPty.backend };
}

function normalizeTerminalFontSize(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 6 || value > 72) {
    return undefined;
  }
  return value;
}

function formatShellLabel(shell: string | null): string | null {
  if (!shell) {
    return null;
  }

  const shellParts = shell.split(/[\\/]/);
  const lastPart = shellParts[shellParts.length - 1];
  const name = lastPart?.replace(/\.exe$/i, "").toLowerCase();
  if (!name) {
    return shell;
  }
  if (name === "powershell" || name === "pwsh") {
    return "PowerShell";
  }
  return name;
}

function isHttpTerminalUrl(text: string): boolean {
  return /^https?:\/\//i.test(text);
}

export function TerminalSession({
  sessionId,
  services,
  cwd,
  isVisible,
  isPanelResizing = false,
  isWindowsDesktop = false,
  onShellLabelChange,
  onExit,
  onOpenBrowserUrl,
  persistentKey,
  workspaceKey,
}: {
  sessionId: string;
  services: IServiceAccessor;
  cwd?: string;
  isVisible: boolean;
  isPanelResizing?: boolean;
  isWindowsDesktop?: boolean;
  onShellLabelChange: (sessionId: string, shellLabel: string | null) => void;
  onExit?: (sessionId: string, exitCode: number) => void;
  onOpenBrowserUrl: (url: string) => void;
  
  persistentKey?: string;
  
  workspaceKey?: string;
}) {
  const { intl } = useCfIntl();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | undefined>(undefined);
  const isVisibleRef = useRef(isVisible);
  const resizeRAFRef = useRef(0);
  const resizeThrottleTimerRef = useRef<number | null>(null);
  const isPanelResizingRef = useRef(isPanelResizing);
  const resizeRequestStatsRef = useRef({ fit: 0, queued: 0, sent: 0, skipped: 0 });
  const lastSentTerminalSizeRef = useRef<TerminalSize | null>(null);
  const pendingTerminalSizeRef = useRef<TerminalSize | null>(null);
  const resizeInFlightRef = useRef(false);
  const focusRAFRef = useRef(0);
  const exitedMessageRef = useRef("");
  const exitHandlerRef = useRef(onExit);
  const openBrowserUrlRef = useRef(onOpenBrowserUrl);
  const terminalProfileThemeRef = useRef<ITheme | undefined>(undefined);
  const pendingInputFallbacksRef = useRef<PendingTerminalInputFallback[]>([]);
  const inputFallbackKeydownCandidateRef = useRef<TerminalInputFallbackKeydownCandidate | null>(
    null,
  );
  const recentInputFallbackHandledDataRef = useRef<TerminalInputFallbackHandledData[]>([]);

  exitedMessageRef.current = intl.formatMessage({ id: "terminal.exited" });
  exitHandlerRef.current = onExit;
  openBrowserUrlRef.current = onOpenBrowserUrl;

  const flushTerminalServiceResize = useCallback(() => {
    if (resizeInFlightRef.current) {
      return;
    }

    const terminalId = terminalIdRef.current;
    const pendingSize = pendingTerminalSizeRef.current;
    if (!terminalId || !pendingSize) {
      return;
    }

    pendingTerminalSizeRef.current = null;
    resizeInFlightRef.current = true;
    resizeRequestStatsRef.current.sent += 1;

    const startedAt = performance.now();
    void services.terminalService
      .resize({
        id: terminalId,
        cols: pendingSize.cols,
        rows: pendingSize.rows,
      })
      .then(() => {
        logger.debug("[Terminal] resize sent", {
          cols: pendingSize.cols,
          durationMs: Math.round(performance.now() - startedAt),
          fitCount: resizeRequestStatsRef.current.fit,
          queuedCount: resizeRequestStatsRef.current.queued,
          rows: pendingSize.rows,
          sentCount: resizeRequestStatsRef.current.sent,
          skippedCount: resizeRequestStatsRef.current.skipped,
          terminalId,
          terminalTabId: sessionId,
        });
      })
      .catch((error) => {
        logger.warn("[Terminal] resize failed:", error);
      })
      .finally(() => {
        resizeInFlightRef.current = false;
        if (pendingTerminalSizeRef.current) {
          flushTerminalServiceResize();
        }
      });
  }, [services.terminalService, sessionId]);

  const queueTerminalServiceResize = useCallback(
    (size: TerminalSize) => {
      const lastSentSize = lastSentTerminalSizeRef.current;
      const pendingSize = pendingTerminalSizeRef.current;
      if (
        (lastSentSize?.cols === size.cols && lastSentSize.rows === size.rows && !pendingSize) ||
        (pendingSize?.cols === size.cols && pendingSize.rows === size.rows)
      ) {
        resizeRequestStatsRef.current.skipped += 1;
        return;
      }

      pendingTerminalSizeRef.current = size;
      lastSentTerminalSizeRef.current = size;
      resizeRequestStatsRef.current.queued += 1;
      flushTerminalServiceResize();
    },
    [flushTerminalServiceResize],
  );

  const clearResizeThrottleTimer = useCallback(() => {
    if (resizeThrottleTimerRef.current) {
      window.clearTimeout(resizeThrottleTimerRef.current);
      resizeThrottleTimerRef.current = null;
    }
  }, []);

  const requestFitAndResize = useCallback(
    (reason: TerminalResizeReason = "observer") => {
      if (resizeRAFRef.current) {
        cancelAnimationFrame(resizeRAFRef.current);
      }

      resizeRAFRef.current = requestAnimationFrame(() => {
        resizeRAFRef.current = 0;
        const el = containerRef.current;
        const term = termRef.current;
        const fitAddon = fitAddonRef.current;
        if (
          !isVisibleRef.current ||
          !el ||
          !term ||
          !fitAddon ||
          el.clientWidth <= 0 ||
          el.clientHeight <= 0
        ) {
          return;
        }

        try {
          resizeRequestStatsRef.current.fit += 1;
          fitAddon.fit();
        } catch (error) {
          logger.warn("[Terminal] fit failed:", error);
          return;
        }

        logger.debug("[Terminal] fit requested resize", {
          cols: term.cols,
          reason,
          resizing: isPanelResizingRef.current,
          rows: term.rows,
          terminalId: terminalIdRef.current,
          terminalTabId: sessionId,
        });
        queueTerminalServiceResize({ cols: term.cols, rows: term.rows });
      });
    },
    [queueTerminalServiceResize, sessionId],
  );

  const scheduleFitAndResize = useCallback(
    (reason: TerminalResizeReason = "observer") => {
      if (!isPanelResizingRef.current || reason === "final") {
        clearResizeThrottleTimer();
        requestFitAndResize(reason);
        return;
      }

      if (resizeThrottleTimerRef.current) {
        return;
      }

      resizeThrottleTimerRef.current = window.setTimeout(() => {
        resizeThrottleTimerRef.current = null;
        requestFitAndResize("drag");
      }, TERMINAL_RESIZE_DRAG_THROTTLE_MS);
    },
    [clearResizeThrottleTimer, requestFitAndResize],
  );

  const requestFocus = useCallback(() => {
    if (focusRAFRef.current) {
      cancelAnimationFrame(focusRAFRef.current);
    }

    focusRAFRef.current = requestAnimationFrame(() => {
      focusRAFRef.current = 0;
      const term = termRef.current;
      if (!isVisibleRef.current || !term) {
        return;
      }

      term.focus();
      logger.debug("[Terminal] focused visible terminal", {
        terminalId: terminalIdRef.current,
        terminalTabId: sessionId,
      });
    });
  }, [sessionId]);

  useEffect(() => {
    isVisibleRef.current = isVisible;
    if (isVisible) {
      scheduleFitAndResize("visible");
      requestFocus();
    }
  }, [isVisible, requestFocus, scheduleFitAndResize]);

  useEffect(() => {
    const wasResizing = isPanelResizingRef.current;
    isPanelResizingRef.current = isPanelResizing;
    if (wasResizing && !isPanelResizing && isVisibleRef.current) {
      scheduleFitAndResize("final");
    }
  }, [isPanelResizing, scheduleFitAndResize]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    if (persistentKey) {
      terminalProfileThemeRef.current = undefined;
      const existingEntry = sidePaneTerminalSessionRegistry.get(persistentKey);

      if (existingEntry) {
        termRef.current = existingEntry.term;
        fitAddonRef.current = existingEntry.fitAddon;
        terminalIdRef.current = existingEntry.terminalId || undefined;
        el.appendChild(existingEntry.hostEl);
        const reuseThemeObserver = new MutationObserver(() => {
          existingEntry.term.options.theme = mergeTerminalTheme(existingEntry.profileTheme);
        });
        reuseThemeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        });
        let reuseResizeRAF = 0;
        const reuseResizeObserver = new ResizeObserver(() => {
          if (!isVisibleRef.current) return;
          if (reuseResizeRAF) cancelAnimationFrame(reuseResizeRAF);
          reuseResizeRAF = requestAnimationFrame(() => scheduleFitAndResize("observer"));
        });
        reuseResizeObserver.observe(el);
        try {
          resizeRequestStatsRef.current.fit += 1;
          existingEntry.fitAddon.fit();
        } catch (error) {
          logger.warn("[Terminal] persistent reuse fit failed:", error);
        }
        if (isVisibleRef.current) {
          requestFocus();
        }
        logger.debug("[Terminal] persistent reuse", {
          terminalTabId: sessionId,
          persistentKey,
        });
        return () => {
          reuseThemeObserver.disconnect();
          reuseResizeObserver.disconnect();
          if (reuseResizeRAF) cancelAnimationFrame(reuseResizeRAF);
          sidePaneTerminalSessionRegistry.detachDom(persistentKey);
          termRef.current = null;
          fitAddonRef.current = null;
        };
      }

      const hostEl = document.createElement("div");
      hostEl.className = "terminal-xterm-shell h-full min-h-0 w-full overflow-hidden";
      el.appendChild(hostEl);

      let ptyCancelled = false;
      const registryDisposers: IDisposable[] = [];
      const localDisposers: IDisposable[] = [];

      const term = new XTerm({
        fontSize: 13,
        fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
        theme: mergeTerminalTheme(terminalProfileThemeRef.current),
        linkHandler: {
          allowNonHttpProtocols: false,
          activate(event, text) {
            if (!isHttpTerminalUrl(text)) return;
            event.preventDefault();
            logger.debug("[Terminal] open OSC 8 http link", { url: text });
            openBrowserUrlRef.current(text);
          },
        } satisfies ILinkHandler,
      });
      termRef.current = term;

      const fitAddon = new FitAddon();
      fitAddonRef.current = fitAddon;
      term.loadAddon(fitAddon);
      term.loadAddon(new ClipboardAddon());
      term.open(hostEl);

      let initialTerminalSize: TerminalSize | null = null;
      if (isVisibleRef.current && hostEl.clientWidth > 0 && hostEl.clientHeight > 0) {
        try {
          resizeRequestStatsRef.current.fit += 1;
          fitAddon.fit();
          initialTerminalSize = { cols: term.cols, rows: term.rows };
          lastSentTerminalSizeRef.current = initialTerminalSize;
          logger.debug("[Terminal] initial fit before create (persistent)", {
            cols: initialTerminalSize.cols,
            rows: initialTerminalSize.rows,
            terminalTabId: sessionId,
          });
        } catch (error) {
          logger.warn("[Terminal] persistent initial fit failed:", error);
        }
      }
      if (isVisibleRef.current) {
        requestFocus();
      }

      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== "keydown") return true;
        inputFallbackKeydownCandidateRef.current =
          e.metaKey || e.ctrlKey || e.altKey
            ? null
            : createTerminalInputFallbackKeydownCandidate({
                eventTimeStamp: e.timeStamp,
                key: e.key,
                now: performance.now(),
              });
        if (!(e.metaKey || e.ctrlKey)) return true;
        const key = e.key.toLowerCase();
        if (key === "c" && term.hasSelection()) {
          void navigator.clipboard.writeText(term.getSelection()).catch((err) => {
            logger.warn("[Terminal] copy via shortcut failed:", err);
          });
          return false;
        }
        if (key === "v") {
          e.preventDefault();
          e.stopPropagation();
          navigator.clipboard
            .readText()
            .then((text) => {
              logger.debug("[Terminal] paste via shortcut", { length: text.length });
              if (text) term.paste(text);
            })
            .catch((err) => logger.warn("[Terminal] paste via shortcut failed:", err));
          return false;
        }
        return true;
      });

      const themeObserver = new MutationObserver(() => {
        term.options.theme = mergeTerminalTheme(entry.profileTheme);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      localDisposers.push({ dispose: () => themeObserver.disconnect() } as IDisposable);

      registryDisposers.push(
        term.registerLinkProvider({
          provideLinks(bufferLineNumber, callback) {
            const links = getHttpLinksForTerminalBufferLine(
              term.buffer.active,
              bufferLineNumber,
              term.cols,
            )?.map(
              (link): ILink => ({
                ...link,
                activate(event, text) {
                  event.preventDefault();
                  logger.debug("[Terminal] open plain http link", { url: text });
                  openBrowserUrlRef.current(text);
                },
              }),
            );
            callback(links);
          },
        }),
      );

      const entry: SidePaneTerminalSessionEntry = {
        key: persistentKey,
        term,
        fitAddon,
        terminalId: "",
        cwd: cwd ?? "",
        workspaceKey: workspaceKey ?? cwd ?? "",
        hostEl,
        dispose: () => {},
      };
      entry.dispose = () => {
        ptyCancelled = true;
        for (const d of registryDisposers) {
          try {
            d.dispose();
          } catch (error) {
            logger.warn("[Terminal] persistent dispose disposer failed:", error);
          }
        }
        if (entry.terminalId) {
          void services.terminalService.dispose({ id: entry.terminalId });
        }
        try {
          term.dispose();
        } catch (error) {
          logger.warn("[Terminal] persistent term.dispose failed:", error);
        }
      };
      sidePaneTerminalSessionRegistry.register(persistentKey, entry);

      const initialCreateSize = initialTerminalSize ?? { cols: term.cols, rows: term.rows };
      void services.terminalService
        .create({ cols: initialCreateSize.cols, rows: initialCreateSize.rows, cwd })
        .then(({ id, shell, fontFamily, fontSize, theme, fontFamilySource, windowsPty }) => {
          if (ptyCancelled) {
            void services.terminalService.dispose({ id });
            return;
          }
          entry.terminalId = id;
          terminalIdRef.current = id;
          flushTerminalServiceResize();
          term.options.windowsPty = normalizeWindowsPtyOption(windowsPty);
          term.options.fontFamily = fontFamily || DEFAULT_TERMINAL_FONT_FAMILY;
          const nextFontSize = normalizeTerminalFontSize(fontSize);
          if (nextFontSize) {
            term.options.fontSize = nextFontSize;
          }
          terminalProfileThemeRef.current = theme as ITheme | undefined;
          entry.profileTheme = theme as ITheme | undefined;
          term.options.theme = mergeTerminalTheme(entry.profileTheme);
          const nextShellLabel = formatShellLabel(shell);
          logger.info("[Terminal] shell resolved (persistent):", {
            cwd,
            fontFamilySource,
            shell,
            shellLabel: nextShellLabel,
            terminalId: id,
            terminalTabId: sessionId,
          });
          onShellLabelChange(sessionId, nextShellLabel);
          scheduleFitAndResize("init");
          if (isVisibleRef.current) {
            requestFocus();
          }

          registryDisposers.push(
            services.terminalService.onDynamicData(id)((data) => {
              term.write(normalizePowerShellReadlineRedraw(data, shell));
            }),
          );
          registryDisposers.push(
            services.terminalService.onDynamicExit(id)((exitCode) => {
              const exitHandler = exitHandlerRef.current;
              logger.info("[Terminal] persistent session exited", {
                autoClose: Boolean(exitHandler),
                exitCode,
                terminalId: id,
                terminalTabId: sessionId,
              });
              if (exitHandler) {
                exitHandler(sessionId, exitCode);
                return;
              }
              term.write(`\r\n${exitedMessageRef.current}\r\n`);
            }),
          );

          //
          registryDisposers.push(
            term.onData((data) => {
              const now = performance.now();
              const inputFallbackKeydownCandidate = inputFallbackKeydownCandidateRef.current;
              const handledData = recordTerminalInputFallbackHandledData({
                candidate: inputFallbackKeydownCandidate,
                data,
                history: recentInputFallbackHandledDataRef.current,
                maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
                now,
              });
              recentInputFallbackHandledDataRef.current = handledData.usedCandidate
                ? handledData.history
                : recordTerminalInputFallbackRecentData({
                    data,
                    history: handledData.history,
                    maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
                    now,
                  });
              if (handledData.usedCandidate) {
                inputFallbackKeydownCandidateRef.current = null;
              }
              markTerminalInputFallbackHandled(pendingInputFallbacksRef.current, data);
              void services.terminalService.write({ id, data });
            }),
          );

          const textarea =
            isWindowsDesktop &&
            (term as unknown as { _core: { textarea: HTMLTextAreaElement } })._core?.textarea;
          if (textarea) {
            const handleInput = (e: InputEvent) => {
              if (e.inputType !== "insertText" || !e.data || !e.composed) return;
              const insertedText = e.data;
              const now = performance.now();
              const pendingFallback = createPendingTerminalInputFallback(insertedText);
              pendingInputFallbacksRef.current.push(pendingFallback);
              consumeTerminalInputFallbackHandledData({
                history: recentInputFallbackHandledDataRef.current,
                inputEventTimeStamp: e.timeStamp,
                maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
                maxInputDelayMs: TERMINAL_INPUT_FALLBACK_KEYDOWN_INPUT_MS,
                now,
                pending: pendingFallback,
              });
              setTimeout(() => {
                pendingInputFallbacksRef.current = pendingInputFallbacksRef.current.filter(
                  (item) => item !== pendingFallback,
                );
                const fallbackAction = resolveTerminalInputFallbackAction({
                  pending: pendingFallback,
                  textareaValue: textarea.value,
                });
                if (fallbackAction.shouldWrite) {
                  logger.debug("[Terminal] flush composed input fallback (persistent)", {
                    length: insertedText.length,
                    terminalId: id,
                    terminalTabId: sessionId,
                  });
                  void services.terminalService.write({ id, data: insertedText });
                }
                if (fallbackAction.shouldClearTextarea) {
                  textarea.value = "";
                }
              }, TERMINAL_INPUT_FALLBACK_FLUSH_DELAY_MS);
            };
            textarea.addEventListener("input", handleInput, true);
            registryDisposers.push({
              dispose: () => textarea.removeEventListener("input", handleInput, true),
            } as IDisposable);
          }
        })
        .catch((error) => {
          if (ptyCancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          logger.error("[Terminal] persistent create failed:", error);
          term.write(`\r\n[Terminal failed to start]\r\n${message}\r\n`);
          //
          const currentEntry = sidePaneTerminalSessionRegistry.get(persistentKey);
          if (currentEntry === entry) {
            sidePaneTerminalSessionRegistry.release(persistentKey);
          }
        });

      let resizeRAF = 0;
      const resizeObserver = new ResizeObserver(() => {
        if (!isVisibleRef.current) return;
        if (resizeRAF) cancelAnimationFrame(resizeRAF);
        resizeRAF = requestAnimationFrame(() => scheduleFitAndResize("observer"));
      });
      resizeObserver.observe(el);

      logger.debug("[Terminal] persistent create", {
        terminalTabId: sessionId,
        persistentKey,
      });

      return () => {
        ptyCancelled = true;
        themeObserver.disconnect();
        resizeObserver.disconnect();
        if (resizeRAF) cancelAnimationFrame(resizeRAF);
        for (const d of localDisposers) {
          try {
            d.dispose();
          } catch (error) {
            logger.warn("[Terminal] persistent cleanup local disposer failed:", error);
          }
        }
        if (!entry.terminalId) {
          sidePaneTerminalSessionRegistry.release(persistentKey);
        } else {
          sidePaneTerminalSessionRegistry.detachDom(persistentKey);
        }
        termRef.current = null;
        fitAddonRef.current = null;
      };
    }

    let disposed = false;
    terminalProfileThemeRef.current = undefined;

    const term = new XTerm({
      fontSize: 13,
      fontFamily: DEFAULT_TERMINAL_FONT_FAMILY,
      theme: mergeTerminalTheme(terminalProfileThemeRef.current),
      linkHandler: {
        allowNonHttpProtocols: false,
        activate(event, text) {
          if (!isHttpTerminalUrl(text)) {
            return;
          }
          event.preventDefault();
          logger.debug("[Terminal] open OSC 8 http link", { url: text });
          openBrowserUrlRef.current(text);
        },
      } satisfies ILinkHandler,
    });
    termRef.current = term;

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    term.loadAddon(fitAddon);
    term.loadAddon(new ClipboardAddon());
    term.open(el);
    let initialTerminalSize: TerminalSize | null = null;
    if (isVisibleRef.current && el.clientWidth > 0 && el.clientHeight > 0) {
      try {
        resizeRequestStatsRef.current.fit += 1;
        fitAddon.fit();
        initialTerminalSize = { cols: term.cols, rows: term.rows };
        lastSentTerminalSizeRef.current = initialTerminalSize;
        logger.debug("[Terminal] initial fit before create", {
          cols: initialTerminalSize.cols,
          rows: initialTerminalSize.rows,
          terminalTabId: sessionId,
        });
      } catch (error) {
        logger.warn("[Terminal] initial fit failed:", error);
      }
    }
    if (isVisibleRef.current) {
      requestFocus();
    }

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      inputFallbackKeydownCandidateRef.current =
        e.metaKey || e.ctrlKey || e.altKey
          ? null
          : createTerminalInputFallbackKeydownCandidate({
              eventTimeStamp: e.timeStamp,
              key: e.key,
              now: performance.now(),
            });
      if (!(e.metaKey || e.ctrlKey)) return true;
      const key = e.key.toLowerCase();
      if (key === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch((err) => {
          logger.warn("[Terminal] copy via shortcut failed:", err);
        });
        return false;
      }
      if (key === "v") {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard
          .readText()
          .then((text) => {
            logger.debug("[Terminal] paste via shortcut", { length: text.length });
            if (text) term.paste(text);
          })
          .catch((err) => logger.warn("[Terminal] paste via shortcut failed:", err));
        return false;
      }
      return true;
    });

    const observer = new MutationObserver(() => {
      term.options.theme = mergeTerminalTheme(terminalProfileThemeRef.current);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const disposables: IDisposable[] = [];
    const { terminalService } = services;
    disposables.push(
      term.registerLinkProvider({
        provideLinks(bufferLineNumber, callback) {
          const links = getHttpLinksForTerminalBufferLine(
            term.buffer.active,
            bufferLineNumber,
            term.cols,
          )?.map(
            (link): ILink => ({
              ...link,
              activate(event, text) {
                event.preventDefault();
                logger.debug("[Terminal] open plain http link", { url: text });
                openBrowserUrlRef.current(text);
              },
            }),
          );

          callback(links);
        },
      }),
    );

    const initialCreateSize = initialTerminalSize ?? { cols: term.cols, rows: term.rows };
    terminalService
      .create({ cols: initialCreateSize.cols, rows: initialCreateSize.rows, cwd })
      .then(({ id, shell, fontFamily, fontSize, theme, fontFamilySource, windowsPty }) => {
        if (disposed) {
          terminalService.dispose({ id });
          return;
        }

        terminalIdRef.current = id;
        flushTerminalServiceResize();
        term.options.windowsPty = normalizeWindowsPtyOption(windowsPty);
        term.options.fontFamily = fontFamily || DEFAULT_TERMINAL_FONT_FAMILY;
        const nextFontSize = normalizeTerminalFontSize(fontSize);
        if (nextFontSize) {
          term.options.fontSize = nextFontSize;
        }
        terminalProfileThemeRef.current = theme as ITheme | undefined;
        term.options.theme = mergeTerminalTheme(terminalProfileThemeRef.current);
        const nextShellLabel = formatShellLabel(shell);
        logger.info("[Terminal] shell resolved:", {
          cwd,
          fontFamilySource,
          shell,
          shellLabel: nextShellLabel,
          terminalId: id,
          terminalTabId: sessionId,
        });
        onShellLabelChange(sessionId, nextShellLabel);
        scheduleFitAndResize("init");
        if (isVisibleRef.current) {
          requestFocus();
        }

        disposables.push(
          terminalService.onDynamicData(id)((data) => {
            term.write(normalizePowerShellReadlineRedraw(data, shell));
          }),
        );

        disposables.push(
          terminalService.onDynamicExit(id)((exitCode) => {
            const exitHandler = exitHandlerRef.current;
            logger.info("[Terminal] terminal session exited", {
              autoClose: Boolean(exitHandler),
              exitCode,
              terminalId: id,
              terminalTabId: sessionId,
            });
            if (exitHandler) {
              exitHandler(sessionId, exitCode);
              return;
            }

            term.write(`\r\n${exitedMessageRef.current}\r\n`);
          }),
        );

        disposables.push(
          term.onData((data) => {
            const now = performance.now();
            const inputFallbackKeydownCandidate = inputFallbackKeydownCandidateRef.current;
            const handledData = recordTerminalInputFallbackHandledData({
              candidate: inputFallbackKeydownCandidate,
              data,
              history: recentInputFallbackHandledDataRef.current,
              maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
              now,
            });
            recentInputFallbackHandledDataRef.current = handledData.usedCandidate
              ? handledData.history
              : recordTerminalInputFallbackRecentData({
                  data,
                  history: handledData.history,
                  maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
                  now,
                });
            if (handledData.usedCandidate) {
              inputFallbackKeydownCandidateRef.current = null;
            }
            markTerminalInputFallbackHandled(pendingInputFallbacksRef.current, data);
            terminalService.write({ id, data });
          }),
        );

        const textarea =
          isWindowsDesktop &&
          (term as unknown as { _core: { textarea: HTMLTextAreaElement } })._core?.textarea;
        if (textarea) {
          const handleInput = (e: InputEvent) => {
            if (e.inputType !== "insertText" || !e.data || !e.composed) return;
            const insertedText = e.data;
            const now = performance.now();
            const pendingFallback = createPendingTerminalInputFallback(insertedText);
            pendingInputFallbacksRef.current.push(pendingFallback);
            consumeTerminalInputFallbackHandledData({
              history: recentInputFallbackHandledDataRef.current,
              inputEventTimeStamp: e.timeStamp,
              maxAgeMs: TERMINAL_INPUT_FALLBACK_RECENT_DATA_MS,
              maxInputDelayMs: TERMINAL_INPUT_FALLBACK_KEYDOWN_INPUT_MS,
              now,
              pending: pendingFallback,
            });

            setTimeout(() => {
              pendingInputFallbacksRef.current = pendingInputFallbacksRef.current.filter(
                (item) => item !== pendingFallback,
              );
              if (disposed) {
                return;
              }
              const fallbackAction = resolveTerminalInputFallbackAction({
                pending: pendingFallback,
                textareaValue: textarea.value,
              });
              if (fallbackAction.shouldWrite) {
                logger.debug("[Terminal] flush composed input fallback", {
                  length: insertedText.length,
                  terminalId: id,
                  terminalTabId: sessionId,
                });
                terminalService.write({ id, data: insertedText });
              }
              if (fallbackAction.shouldClearTextarea) {
                textarea.value = "";
              }
            }, TERMINAL_INPUT_FALLBACK_FLUSH_DELAY_MS);
          };

          textarea.addEventListener("input", handleInput, true);
          disposables.push({
            dispose: () => textarea.removeEventListener("input", handleInput, true),
          } as IDisposable);
        }
      })
      .catch((error) => {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.error("[Terminal] failed to create terminal:", error);
        term.write(`\r\n[Terminal failed to start]\r\n${message}\r\n`);
      });

    let resizeRAF = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (!isVisibleRef.current) return;
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      resizeRAF = requestAnimationFrame(() => scheduleFitAndResize("observer"));
    });
    resizeObserver.observe(el);

    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      clearResizeThrottleTimer();
      if (resizeRAF) cancelAnimationFrame(resizeRAF);
      if (resizeRAFRef.current) cancelAnimationFrame(resizeRAFRef.current);
      if (focusRAFRef.current) cancelAnimationFrame(focusRAFRef.current);
      pendingInputFallbacksRef.current = [];
      inputFallbackKeydownCandidateRef.current = null;
      recentInputFallbackHandledDataRef.current = [];
      pendingTerminalSizeRef.current = null;
      lastSentTerminalSizeRef.current = null;
      resizeInFlightRef.current = false;
      for (const d of disposables) d.dispose();
      if (terminalIdRef.current) {
        terminalService.dispose({ id: terminalIdRef.current });
      }
      terminalIdRef.current = undefined;
      fitAddonRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, [
    clearResizeThrottleTimer,
    cwd,
    isWindowsDesktop,
    onShellLabelChange,
    requestFocus,
    scheduleFitAndResize,
    flushTerminalServiceResize,
    services,
    sessionId,
    persistentKey,
  ]);

  const handleCopy = () => {
    const term = termRef.current;
    if (!term?.hasSelection()) return;
    void navigator.clipboard.writeText(term.getSelection()).catch((err) => {
      logger.warn("[Terminal] copy via context menu failed:", err);
    });
  };

  const handlePaste = () => {
    const term = termRef.current;
    if (!term) return;
    navigator.clipboard
      .readText()
      .then((text) => text && term.paste(text))
      .catch((err) => logger.warn("[Terminal] paste via context menu failed:", err));
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className="terminal-xterm-shell h-full min-h-0 w-full overflow-hidden"
        />
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={handleCopy}>
          <Copy className="mr-2 h-4 w-4" />
          {intl.formatMessage({ id: "terminal.contextMenu.copy" })}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handlePaste}>
          <ClipboardPaste className="mr-2 h-4 w-4" />
          {intl.formatMessage({ id: "terminal.contextMenu.paste" })}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
