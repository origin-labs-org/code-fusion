import { getCfCopy, type SupportedLocale, type UiLocale } from "@origin-ai/cf-i18n";

export function formatCliHelp(
  version: string,
  locale?: UiLocale,
  detectedLocale?: SupportedLocale,
): string {
  return getCfCopy(locale, detectedLocale).cli.help(version);
}
