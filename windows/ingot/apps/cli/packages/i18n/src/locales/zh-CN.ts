/**
 * zh-CN catalog.
 *
 * The CJK purge removed the translated payload (the file used to carry the
 * Simplified Chinese copy). The locale stays selectable so `SupportedLocale`
 * remains whole, and falls back to the en-US catalog until a translation is
 * contributed — no mixed-language UI is produced.
 */
import { enUS } from "./en-US.js";
import type { CfCopy } from "../types.js";

export const zhCN: CfCopy = enUS;
