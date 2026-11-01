import type { MediaView } from "./board/types";

const VIDEO_ID = /^[\w-]{11}$/u;

/** The video a YouTube address plays: watch, youtu.be and shorts links. */
export function youtubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./u, "");
  const path = parsed.pathname.split("/").filter(Boolean);
  const id =
    host === "youtu.be"
      ? path[0]
      : host === "youtube.com" && path[0] === "watch"
        ? parsed.searchParams.get("v")
        : host === "youtube.com" && path[0] === "shorts"
          ? path[1]
          : null;
  return id && VIDEO_ID.test(id) ? id : null;
}

/**
 * The poster YouTube itself serves for a video, from its image host: the one
 * address a video link's picture is fetched from. Rust fetches it once,
 * without cookies, and the canvas only ever draws the stored copy.
 */
export function youtubeThumbnail(url: string): string | null {
  const id = youtubeId(url);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

/**
 * A link stored with what its video page said carries the title, then the
 * channel on the next line; as pasted it carries the bare host.
 */
export function splitLinkTitle(stored: string): { title: string; channel?: string } {
  const [title = "", ...rest] = stored.split("\n");
  const channel = rest.join(" ").trim();
  return { title: title.trim(), ...(channel ? { channel } : {}) };
}

/** Whether a link still carries the bare host it was pasted with. */
export function isBareTitle(stored: string, url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./u, "");
    return stored.replace(/^www\./u, "") === host;
  } catch {
    return false;
  }
}

/** Only addresses actually observed by a source are candidates. */
export function pickCandidates(item: {
  image_candidates?: readonly string[] | null;
  media_attempted?: boolean;
  url?: string | null;
}): string[] {
  return item.media_attempted ? [] : [...(item.image_candidates ?? [])];
}

/** The start a YouTube address asks for: `t=90`, `t=1m30s` or `start=90`, in seconds. */
function startOf(url: string): number | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const value = parsed.searchParams.get("t") ?? parsed.searchParams.get("start");
  if (!value) return undefined;
  const parts = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/u.exec(value);
  if (!parts) return undefined;
  const seconds = Number(parts[1] ?? 0) * 3600 + Number(parts[2] ?? 0) * 60 + Number(parts[3] ?? 0);
  return seconds > 0 ? seconds : undefined;
}

/**
 * A link that is a YouTube video, as the video it is: its poster the admitted
 * thumbnail when there is one, its start where the address points. Other links
 * stay links.
 */
export function linkVideo(
  id: string,
  url: string,
  {
    title,
    channel,
    poster,
  }: { title?: string; channel?: string; poster?: MediaView["poster"] } = {},
): MediaView | null {
  if (!youtubeId(url)) return null;
  const start = startOf(url);
  return {
    kind: "media",
    id,
    media: "video",
    url,
    provider: "youtube",
    ...(title ? { title } : {}),
    ...(title && channel ? { channel } : {}),
    ...(poster ? { poster } : {}),
    ...(start ? { startSecs: start } : {}),
  };
}
