
import { useEffect, useRef } from "react";
import type { ShortcutCommandId, CfConfigOption } from "@origin-ai/cf-shared";
import {
  isShortcutRecordingActive,
  matchesShortcutBinding,
  type EffectiveShortcutBindings,
} from "@/shortcuts/bindings.js";
import { useEffectiveShortcutBindings } from "@/shortcuts/useShortcutBindings.js";
import { logger } from "@/logger.js";

type ChatToolbarShortcutKey = "m" | "ctrlShiftM" | "t" | null;

export function getChatToolbarShortcutKey(
  category: CfConfigOption["category"],
): ChatToolbarShortcutKey {
  switch (category) {
    case "model":
      return "m";
    case "mode":
      return "ctrlShiftM";
    case "thought_level":
      return "t";
    default:
      return null;
  }
}

export function getNextConfigSelectValue(
  option: Pick<CfConfigOption, "type" | "currentValue" | "options">,
): string | null {
  if (option.type !== "select" || !option.options?.length) {
    return null;
  }

  const currentValue = String(option.currentValue);
  const currentIndex = option.options.findIndex((candidate) => candidate.value === currentValue);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % option.options.length;

  return option.options[nextIndex]?.value ?? null;
}

interface ToolbarShortcutKeyboardEvent {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
  repeat: boolean;
  isComposing: boolean;
}

interface ToolbarShortcutState {
  hasAnyOption: boolean;
  toolbarDisabled: boolean;
  modelMenuDisabled: boolean;
  modelOption?: CfConfigOption;
  modeOption?: CfConfigOption;
  thoughtOption?: CfConfigOption;
}

type ToolbarShortcutAction = "openModelMenu" | "cycleSessionMode" | "cycleThoughtLevel";

export function resolveToolbarShortcutAction(
  event: ToolbarShortcutKeyboardEvent,
  effective: EffectiveShortcutBindings,
  {
    hasAnyOption,
    toolbarDisabled,
    modelMenuDisabled,
    modelOption,
    modeOption,
    thoughtOption,
  }: ToolbarShortcutState,
): ToolbarShortcutAction | null {
  if (
    !hasAnyOption ||
    toolbarDisabled ||
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing
  ) {
    return null;
  }

  const candidates: ReadonlyArray<{
    action: ToolbarShortcutAction;
    commandId: ShortcutCommandId;
    expectedKey: ChatToolbarShortcutKey;
    option?: CfConfigOption;
    disabled?: boolean;
  }> = [
    {
      action: "openModelMenu",
      commandId: "openModelMenu",
      expectedKey: "m",
      option: modelOption,
      disabled: modelMenuDisabled,
    },
    {
      action: "cycleSessionMode",
      commandId: "cycleSessionMode",
      expectedKey: "ctrlShiftM",
      option: modeOption,
    },
    {
      action: "cycleThoughtLevel",
      commandId: "cycleThoughtLevel",
      expectedKey: "t",
      option: thoughtOption,
    },
  ];

  for (const candidate of candidates) {
    if (candidate.disabled) {
      continue;
    }
    if (!candidate.option || getChatToolbarShortcutKey(candidate.option.category) !== candidate.expectedKey) {
      continue;
    }
    for (const binding of effective[candidate.commandId] ?? []) {
      if (matchesShortcutBinding(event, binding)) {
        return candidate.action;
      }
    }
  }

  return null;
}

export function useToolbarShortcutBindings(params: {
  hasAnyOption: boolean;
  toolbarDisabled: boolean;
  modelMenuDisabled: boolean;
  modelOption?: CfConfigOption;
  modeOption?: CfConfigOption;
  thoughtOption?: CfConfigOption;
  onOpenModelMenu: () => void;
  
  onCycleSessionMode: () => void;
  
  onCycleThoughtLevel: () => void;
}) {
  const {
    hasAnyOption,
    toolbarDisabled,
    modelMenuDisabled,
    modelOption,
    modeOption,
    thoughtOption,
    onOpenModelMenu,
    onCycleSessionMode,
    onCycleThoughtLevel,
  } = params;
  const effectiveBindings = useEffectiveShortcutBindings();
  const effectiveRef = useRef(effectiveBindings);
  effectiveRef.current = effectiveBindings;

  useEffect(() => {
    if (!hasAnyOption) {
      return;
    }

    function handleWindowKeydown(event: KeyboardEvent) {
      if (isShortcutRecordingActive()) {
        return;
      }
      const state = {
        hasAnyOption,
        toolbarDisabled,
        modelMenuDisabled,
        modelOption,
        modeOption,
        thoughtOption,
      };
      const action = resolveToolbarShortcutAction(event, effectiveRef.current, state);
      if (!action) {
        const openModelMenuBound = (effectiveRef.current.openModelMenu ?? []).some((binding) =>
          matchesShortcutBinding(event, binding),
        );
        if (openModelMenuBound) {
          logger.debug("[V4ComposerToolbar] 模型菜单热键未打开模型菜单", {
            hasModelOption: Boolean(modelOption),
            shortcutKey: getChatToolbarShortcutKey(modelOption?.category),
            modelMenuDisabled,
          });
        }
        return;
      }

      event.preventDefault();
      if (action === "openModelMenu") {
        logger.debug("[V4ComposerToolbar] Ctrl+M to open model menu");
        onOpenModelMenu();
        return;
      }

      if (action === "cycleSessionMode") {
        onCycleSessionMode();
        return;
      }

      if (action === "cycleThoughtLevel") {
        onCycleThoughtLevel();
      }
    }

    window.addEventListener("keydown", handleWindowKeydown, true);
    return () => {
      window.removeEventListener("keydown", handleWindowKeydown, true);
    };
  }, [
    hasAnyOption,
    toolbarDisabled,
    modelMenuDisabled,
    modeOption,
    modelOption,
    onOpenModelMenu,
    onCycleSessionMode,
    onCycleThoughtLevel,
    thoughtOption,
  ]);
}
