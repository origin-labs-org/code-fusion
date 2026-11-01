/** The loaded dictionary of the language shown, in `messages/en.json` order,
 *  or none for English. Set just before the locale changes, so every message
 *  reads it as it redraws. */
let dictionary: readonly (string | null)[] | null = null;

export function setTranslations(next: readonly (string | null)[] | null) {
  dictionary = next;
}

/** @public Read by every message, through the `i18n-locales` build transform. */
export function translated(at: number, inputs?: Record<string, unknown>): string | undefined {
  const text = dictionary?.[at];
  if (text == null) return undefined;
  return text.replace(/\{(\w+)\}/gu, (_, name: string) => String(inputs?.[name] ?? ""));
}
