import { hostOf } from "./site";

type Page = { url: string; where: string; title: string };

/** The words of an address after its host: a search's query, else its last two path segments. */
function trail(url: string): string[] {
  try {
    const parsed = new URL(url);
    const query = ["q", "query", "search", "string", "text", "term", "k", "keywords"]
      .map((key) => parsed.searchParams.get(key)?.trim())
      .find(Boolean);
    if (query) return [query];
    return parsed.pathname
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .map((segment) =>
        decodeURIComponent(segment)
          .replace(/\.[a-z0-9]{2,5}$/iu, "")
          .replace(/[-_+]+/gu, " ")
          .trim(),
      )
      .filter(Boolean);
  } catch {
    return [];
  }
}

const bare = (host: string) => host.replace(/^www\./u, "").toLowerCase();

/** A title that is only the site's name says nothing the site does not. */
function titled(page: Page): string {
  const title = page.title.trim();
  return title && bare(title) !== (bare(page.where) || hostOf(page.url)) ? title : "";
}

export type ResultLabel = {
  /** The page's title, or its address in words when it gave none. */
  text: string;
  /** The site, when the row does not already say it and the list is not all one site. */
  site: string;
};

/**
 * A search result as its row reads: the title, with the site beside it only
 * when it adds something. A page with no title is named by its address
 * (`allegro.pl › listing › rtx 3090`), so the bare host never shows twice.
 */
export function resultLabel(page: Page, oneSite = false): ResultLabel {
  const where = bare(page.where) || hostOf(page.url);
  const title = titled(page);
  if (title)
    return { text: title, site: oneSite || title.toLowerCase().includes(where) ? "" : where };
  return { text: [where, ...trail(page.url)].join(" › "), site: "" };
}

/** The one site every page is on, so a list can name it once; empty for a mix, a file, or a lone page. */
export function sharedSite(pages: readonly { host: string; file?: unknown }[]): string {
  const first = pages[0]?.host ?? "";
  return pages.length > 1 && pages.every((page) => !page.file && page.host === first) ? first : "";
}

/** A cited page inside a list that already names its site: the title, else the address past the host. */
export function pageLabel(page: Page): string {
  return titled(page) || trail(page.url).join(" › ") || bare(page.where);
}
