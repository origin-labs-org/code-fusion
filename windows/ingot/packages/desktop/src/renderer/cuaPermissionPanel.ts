import type {
  CuaPermissionKind,
  Locale,
  PrepareCuaHelperPermissionDragResult,
} from "@origin-ai/cf-shared";
import { resolveCuaPermissionPanelMessages } from "./cuaPermissionPanelMessages.js";

interface CuaPermissionPanelState {
  permission: CuaPermissionKind;
  locale: Locale;
  iconDataUrl: string | null;
}

declare global {
  interface Window {
    cuaPermissionPanel?: {
      prepareDrag?(): Promise<PrepareCuaHelperPermissionDragResult>;
      startDrag?(): void;
      notifyDragEnded?(): void;
      onState?(callback: (state: CuaPermissionPanelState) => void): () => void;
    };
  }
}

const bridge = window.cuaPermissionPanel;
const tile = document.getElementById("tile");
const hintPrefix = document.getElementById("hintPrefix");
const permissionLabel = document.getElementById("permissionLabel");
const hintSuffix = document.getElementById("hintSuffix");
const completion = document.getElementById("completion");
const icon = document.querySelector<HTMLElement>(".icon");

bridge
  ?.prepareDrag?.()
  .then((result) => {
    const appName = document.getElementById("appName");
    if (result?.helperDisplayName && appName) {
      appName.textContent = result.helperDisplayName;
    }
  })
  .catch(() => {});

bridge?.onState?.((state) => {
  const messages = resolveCuaPermissionPanelMessages(state.locale, state.permission);
  document.documentElement.lang = state.locale;
  document.title = messages.documentTitle;
  if (tile) tile.title = messages.dragTitle;
  if (hintPrefix) hintPrefix.textContent = messages.hintPrefix;
  if (permissionLabel) permissionLabel.textContent = messages.permissionLabel;
  if (hintSuffix) hintSuffix.textContent = messages.hintSuffix;
  if (completion) completion.textContent = messages.completion;
  if (state.iconDataUrl && icon) {
    icon.style.backgroundImage = `url("${state.iconDataUrl}")`;
  }
});

let dragStarted = false;

tile?.addEventListener("dragstart", (event) => {
  event.preventDefault();
  dragStarted = true;
  bridge?.startDrag?.();
});

const notifyDragEnded = () => {
  if (!dragStarted) return;
  dragStarted = false;
  bridge?.notifyDragEnded?.();
};

tile?.addEventListener("dragend", notifyDragEnded);
document.addEventListener("mouseup", notifyDragEnded);
