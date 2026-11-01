
import { useMemo } from "react";
import { type ShortcutCommandId } from "@origin-ai/cf-shared";
import { useSettings } from "@/hooks/useSettingService.js";
import { resolveEffectiveShortcutBindings, type EffectiveShortcutBindings } from "./bindings.js";
import { formatShortcutBindingLabel } from "./label.js";

export function useEffectiveShortcutBindings(): EffectiveShortcutBindings {
  const { settings } = useSettings();
  const overrides = settings?.shortcutBindings;
  return useMemo(() => resolveEffectiveShortcutBindings(overrides), [overrides]);
}

export function useShortcutCommandLabel(commandId: ShortcutCommandId): string {
  const effective = useEffectiveShortcutBindings();
  const first = effective[commandId]?.[0] ?? "";
  return first === "" ? "" : formatShortcutBindingLabel(first);
}
