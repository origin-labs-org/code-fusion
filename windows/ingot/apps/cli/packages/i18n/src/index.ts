import type { UiLocale, SupportedLocale } from "@origin-ai/cf-contracts";
import { enUS } from "./locales/en-US.js";
import { zhCN } from "./locales/zh-CN.js";
import {
  DEFAULT_LOCALE,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
  SUPPORTED_LOCALES,
} from "./locale.js";
import type { CfCopy } from "./types.js";

export {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  detectLocale,
  isSupportedLocale,
  isUiLocale,
  resolveLocale,
};
export type { LocaleDetectionInput } from "./locale.js";
export type { CliCopy, TuiCopy, UiLocale, SupportedLocale, CfCopy } from "./types.js";

const CATALOGS: Record<SupportedLocale, CfCopy> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

export function getCfCopy(locale?: UiLocale | string, detected?: string | null): CfCopy {
  return CATALOGS[resolveLocale(locale, detected)];
}
