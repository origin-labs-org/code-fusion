import { thoughtLevelLabelId } from "@/chat-input-toolbar/thoughtLevelLabels.js";
export { thoughtLevelLabelId } from "@/chat-input-toolbar/thoughtLevelLabels.js";
import type { CfConfigOption, CfProvider } from "@origin-ai/cf-shared";
import type { useCfIntl } from "@/i18n/IntlProvider.js";
import { getConfigOptionEntryLabel } from "@/chat-input-toolbar/display.js";

export type ThoughtLevelEntry = NonNullable<CfConfigOption["options"]>[number];

const NO_THOUGHT_LEVEL_VALUES = new Set([
  "disabled",
  "false",
  "no",
  "none",
  "nothink",
  "no-think",
  "no_think",
  "off",
]);

function normalizeThoughtLevelText(value: string): string {
  return value.trim().toLowerCase();
}

export function isNoThoughtLevel(entry: Pick<ThoughtLevelEntry, "value">): boolean {
  return NO_THOUGHT_LEVEL_VALUES.has(normalizeThoughtLevelText(entry.value));
}

export function getNextThoughtLevelValue(
  option: Pick<CfConfigOption, "type" | "currentValue" | "options">,
): string | null {
  if (option.type !== "select" || !option.options || option.options.length < 2) {
    return null;
  }

  const entries = option.options;
  const currentValue = String(option.currentValue);
  const currentIndex = entries.findIndex((candidate) => candidate.value === currentValue);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % entries.length;

  return entries[nextIndex]?.value ?? null;
}

export function getThoughtLevelLabel(
  intl: ReturnType<typeof useCfIntl>["intl"],
  provider: CfProvider | undefined,
  option: CfConfigOption,
  entry: ThoughtLevelEntry,
): string {
  const labelId = thoughtLevelLabelId(entry.value);
  if (labelId) {
    return intl.formatMessage({ id: labelId });
  }

  return getConfigOptionEntryLabel(intl, provider, option, entry);
}
