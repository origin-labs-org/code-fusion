//
//
//

import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";

export interface SidePaneTerminalSessionEntry {
  key: string;
  term: XTerm;
  fitAddon: FitAddon;
  terminalId: string;
  cwd: string;
  
  workspaceKey: string;
  hostEl: HTMLDivElement;
  
  profileTheme?: ITheme;
  
  dispose: () => void;
}

const sessions = new Map<string, SidePaneTerminalSessionEntry>();
uiMemoryDiagnosticsRegistry.register("xterm", () => ({ sessions: sessions.size }));

let stashDiv: HTMLDivElement | null = null;

function getStashDiv(): HTMLDivElement | null {
  if (typeof document === "undefined") return null;
  if (!stashDiv) {
    stashDiv = document.createElement("div");
    stashDiv.style.display = "none";
    stashDiv.setAttribute("data-side-pane-terminal-stash", "");
    document.body.appendChild(stashDiv);
  }
  return stashDiv;
}

function releaseEntry(key: string): void {
  const entry = sessions.get(key);
  if (!entry) return;
  sessions.delete(key);
  try {
    entry.dispose();
  } catch (error) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[sidePaneTerminalSessionRegistry] release dispose failed", error);
    }
  }
  entry.hostEl.remove();
}

export const sidePaneTerminalSessionRegistry = {
  has(key: string): boolean {
    return sessions.has(key);
  },

  get(key: string): SidePaneTerminalSessionEntry | undefined {
    return sessions.get(key);
  },

  
  register(key: string, entry: SidePaneTerminalSessionEntry): void {
    sessions.set(key, entry);
  },

  
  attachDom(key: string, host: HTMLElement): void {
    const entry = sessions.get(key);
    if (!entry) return;
    if (entry.hostEl.parentElement === host) return;
    host.appendChild(entry.hostEl);
  },

  
  detachDom(key: string): void {
    const entry = sessions.get(key);
    if (!entry) return;
    const stash = getStashDiv();
    if (!stash) return;
    if (entry.hostEl.parentElement === stash) return;
    stash.appendChild(entry.hostEl);
  },

  
  release(key: string): void {
    releaseEntry(key);
  },

  
  releaseByPredicate(pred: (entry: SidePaneTerminalSessionEntry) => boolean): void {
    for (const [key, entry] of sessions) {
      if (pred(entry)) {
        releaseEntry(key);
      }
    }
  },

  
  clearForTest(): void {
    for (const key of Array.from(sessions.keys())) {
      releaseEntry(key);
    }
    sessions.clear();
    if (stashDiv && typeof document !== "undefined") {
      stashDiv.remove();
      stashDiv = null;
    }
  },
};
