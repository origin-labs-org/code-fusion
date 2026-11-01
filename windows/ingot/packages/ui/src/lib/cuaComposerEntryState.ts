
import { isCuaPermissionStatusAvailable, type CuaPermissionStatusResult } from "@origin-ai/cf-services";
import { isCuaPermissionTccGranted } from "@/lib/cuaPermissionStatusStore.js";
import type { StatusDotTone } from "@/settings/StatusDot.js";

export type CuaComposerEntryUiState =
  | "starting"
  
  | "idle"
  | "permission-required"
  | "ready"
  | "error";

export interface CuaComposerEntryInputs {
  
  macLocalDesktop: boolean;
  
  windowsLocalDesktop: boolean;
  
  hiddenBySettings: boolean;
  
  permissionServiceAvailable: boolean;
  
  pluginEnabled: boolean;
  
  pluginToggling: boolean;
  
  pluginError: boolean;
  
  permissionStatus: CuaPermissionStatusResult | null;
  
  sessionBusy: boolean;
}

export type CuaComposerEntryView =
  | { visible: false }
  | {
      visible: true;
      uiState: CuaComposerEntryUiState;
      tone: StatusDotTone;
      spinning: boolean;
      tooltipMessageId: string;
      
      clickAction: "open-settings" | "none";
      
      interactionDisabled: boolean;
    };

const TOOLTIP_MESSAGE_ID: Record<CuaComposerEntryUiState, string> = {
  idle: "chat.toolbar.computerUse.tooltip.idle",
  starting: "chat.toolbar.computerUse.tooltip.starting",
  "permission-required": "chat.toolbar.computerUse.tooltip.permissionRequired",
  ready: "chat.toolbar.computerUse.tooltip.ready",
  error: "chat.toolbar.computerUse.tooltip.error",
};

const BUSY_TOOLTIP_MESSAGE_ID = "chat.toolbar.computerUse.tooltip.sessionBusy";

function isEntryVisible(inputs: CuaComposerEntryInputs): boolean {
  if (!inputs.macLocalDesktop && !inputs.windowsLocalDesktop) return false;
  if (inputs.hiddenBySettings) return false;
  if (inputs.macLocalDesktop && !inputs.permissionServiceAvailable) return false;
  if (!inputs.pluginEnabled && !inputs.pluginToggling) return false;
  return true;
}

function resolveUiState(inputs: CuaComposerEntryInputs): CuaComposerEntryUiState {
  if (inputs.pluginToggling) return "starting";
  if (inputs.pluginError) return "error";

  if (!inputs.macLocalDesktop) return "ready";

  if (inputs.permissionStatus === null) return "idle";

  if (!isCuaPermissionStatusAvailable(inputs.permissionStatus)) {
    if ((inputs.permissionStatus as { idle?: true }).idle === true) return "idle";
    return "error";
  }

  return isCuaPermissionTccGranted(inputs.permissionStatus) ? "ready" : "permission-required";
}

export function resolveCuaComposerEntryView(inputs: CuaComposerEntryInputs): CuaComposerEntryView {
  if (!isEntryVisible(inputs)) return { visible: false };

  const uiState = resolveUiState(inputs);
  const interactionDisabled = false;

  return {
    visible: true,
    uiState,
    tone: "subtle",
    spinning: uiState === "starting",
    tooltipMessageId: interactionDisabled ? BUSY_TOOLTIP_MESSAGE_ID : TOOLTIP_MESSAGE_ID[uiState],
    clickAction: interactionDisabled ? "none" : "open-settings",
    interactionDisabled,
  };
}
