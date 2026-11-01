/**
 * The interface language. Paraglide compiles English only; every other
 * language is a dictionary chunk loaded when chosen, so no screen carries
 * all of them. Paraglide reads the locale through `getLocale`; backing it
 * with state re-renders every message in place when the language changes.
 */
import { baseLocale, overwriteGetLocale } from "$shared/i18n/runtime";
import { setTranslations } from "./translations";

const dictionaries = import.meta.glob<readonly (string | null)[]>(
  ["../../../messages/*.json", "!../../../messages/en.json"],
  { import: "default", query: "?dictionary" },
);
const loaders = new Map(
  Object.entries(dictionaries).map(([path, load]) => [
    path.slice(path.lastIndexOf("/") + 1, -5),
    load,
  ]),
);

let current = $state<string>(baseLocale);
overwriteGetLocale(() => current as typeof baseLocale);
let requested = baseLocale as string;

const translated = (tag: string) => tag === baseLocale || loaders.has(tag);

/** The first of the system's languages this build is translated into. */
export function systemLocale(): string {
  for (const raw of navigator.languages ?? [navigator.language]) {
    // Apple names Chinese by script; the dictionaries are named by region.
    const tag = raw.replace(/^zh-Hant\b.*/iu, "zh-TW").replace(/^zh-Hans\b.*/iu, "zh-CN");
    if (translated(tag)) return tag;
    const base = tag.split("-")[0];
    if (base && translated(base)) return base;
  }
  return baseLocale;
}

/** Applies the `ui.language` preference: a locale id, or "system". Settles
 *  once the language is shown, so startup can wait instead of flashing. */
export async function applyLanguage(preference: string | null | undefined): Promise<void> {
  const wanted = !preference || preference === "system" ? systemLocale() : preference;
  const next = translated(wanted) ? wanted : baseLocale;
  requested = next;
  let dictionary: readonly (string | null)[] | null = null;
  if (next !== baseLocale) {
    try {
      dictionary = await loaders.get(next)!();
    } catch {
      if (requested === next) show(baseLocale, null);
      return;
    }
  }
  if (requested === next) show(next, dictionary);
}

function show(locale: string, dictionary: readonly (string | null)[] | null) {
  setTranslations(dictionary);
  current = locale;
  document.documentElement.lang = locale;
  document.documentElement.dir = RIGHT_TO_LEFT.has(locale.split("-")[0]!) ? "rtl" : "ltr";
}

/** The languages the interface is translated into, English first. */
export const interfaceLanguages = (): string[] => [baseLocale, ...loaders.keys()];

/** Every language the interface may be set to, translated or not yet; also
 *  the spoken languages dictation offers. Mirrors
 *  `zephium_core::preferences::LANGUAGES`. */
const INTERFACE_LANGUAGES = [
  "en",
  "ar",
  "bg",
  "bn",
  "ca",
  "cs",
  "da",
  "de",
  "el",
  "es",
  "es-419",
  "et",
  "fa",
  "fi",
  "fil",
  "fr",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "lt",
  "lv",
  "ms",
  "nb",
  "nl",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sl",
  "sr",
  "sv",
  "sw",
  "ta",
  "te",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-CN",
  "zh-TW",
] as const;

const RIGHT_TO_LEFT = new Set(["ar", "fa", "he"]);

export const languages = (): readonly string[] => INTERFACE_LANGUAGES;
