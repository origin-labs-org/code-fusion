import type { ProfileEntryView } from "$shared/ipc/bindings";
import { IS_MAC } from "$shared/platform";

const ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const base = IS_MAC
  ? "zephium-media://localhost/avatar/"
  : "http://zephium-media.localhost/avatar/";

/** A saved photo, by revision so a new picture is never served from cache. */
const photoUrl = (profile: string, revision: number) =>
  ID.test(profile) ? `${base}${profile}/${revision}` : null;
/** A picked photo not yet saved, staged natively under its token. */
export const stagedUrl = (token: string) => (ID.test(token) ? `${base}staged/${token}` : null);

/** One or two letters for a profile's name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = (word: string | undefined) =>
    [...(word ?? "")].find((c) => /\p{L}|\p{N}/u.test(c)) ?? "";
  const letters = words.length >= 2 ? first(words[0]) + first(words.at(-1)) : first(words[0]);
  return letters.toLocaleUpperCase();
}

type AvatarStyle = ProfileEntryView["avatar"]["style"];
export type DrawnAvatar = {
  style: AvatarStyle;
  color: number;
  symbol: number;
  initials: string;
  src: string | null;
};

/** What a profile's avatar draws; display-only, for `ProfileAvatar`. */
export function drawn(profile: Pick<ProfileEntryView, "id" | "name" | "avatar">): DrawnAvatar {
  const { style, color, symbol, revision } = profile.avatar;
  return {
    style,
    color,
    symbol,
    initials: initialsOf(profile.name),
    src: style === "photo" ? photoUrl(profile.id, revision) : null,
  };
}

/** Who the identity card shows: the window's profile as drawn, or, until one
 *  is chosen, the account's own picture, or else quiet initials for it. */
export function identityAvatar(
  profile: ProfileEntryView | null,
  initials: string,
  photo: string | null = null,
): DrawnAvatar {
  if (profile && profile.avatar.revision > 0) return drawn(profile);
  return { style: photo ? "photo" : "initials", color: 0, symbol: 0, initials, src: photo };
}
