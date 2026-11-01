import type { Locale, PostUpdateReleaseNotesPayload } from "@origin-ai/cf-shared";

export type LocalizedUpdateReleaseNotes = {
  title: string;
  markdown: string;
};

export function getLocalizedUpdateReleaseNotes(
  payload: PostUpdateReleaseNotesPayload | undefined,
  locale: Locale,
): LocalizedUpdateReleaseNotes | null {
  if (!payload) {
    return null;
  }

  const defaultReleaseNotes = {
    title: payload.title,
    markdown: payload.markdown,
  };

  return (
    payload.releaseNotesByLocale?.[locale] ??
    (locale === "zh-CN"
      ? defaultReleaseNotes
      : (payload.releaseNotesByLocale?.["zh-CN"] ?? defaultReleaseNotes))
  );
}

export function formatUpdateReleaseDate(
  releaseDate: string | undefined,
  locale: Locale,
): string | null {
  if (!releaseDate) {
    return null;
  }

  const date = new Date(releaseDate);
  if (Number.isNaN(date.getTime())) {
    return releaseDate;
  }

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}
