import type { PartNeed } from "../canvas-model";
import type { HumanPage } from "../work-human";

type Waiting = { url: string; human?: HumanPage; read?: boolean };

type Slot<Page extends Waiting> = {
  id: string;
  host?: string;
  need?: PartNeed;
  pages: readonly Page[];
};

export type Settled<Page extends Waiting> = {
  pages: Page[];
  need: PartNeed | undefined;
  /** On the part that holds a site's wait: how many of that site's pages wait, when more than one. */
  pending: number;
};

const bare = (host: string) => host.replace(/^www\./u, "").toLowerCase();

function hostOf(url: string): string {
  try {
    return bare(new URL(url).hostname);
  } catch {
    return "";
  }
}

/** The site a check or a sign-in is met on: what it is told apart by. */
function siteOf(slot: Slot<Waiting>): string {
  const need = slot.need;
  if (!need) return "";
  if (need.kind === "check" || need.kind === "sign_in") return hostOf(need.address ?? "");
  if (need.kind === "retry" && need.reason === "blocked_by_check") return bare(slot.host ?? "");
  return "";
}

const waits = (page: { human?: HumanPage }) => page.human?.phase === "waiting_for_human";

/**
 * One need per site per run. A page the run waits on is the need: the first
 * waiting page of a site keeps it and the site's other waiting pages are only
 * counted. The remedy an ended part offers for a check or a sign-in is dropped
 * when a page of the site is held for the person, when the site was read
 * after all, or when an earlier part already offers it.
 */
export function settleNeeds<Page extends Waiting>(
  slots: readonly Slot<Page>[],
): Map<string, Settled<Page>> {
  const held = new Map<string, { part: string; page: unknown; count: number }>();
  const read = new Set<string>();
  for (const slot of slots) {
    for (const page of slot.pages) {
      const host = hostOf(page.url);
      if (page.read) read.add(host);
      if (!waits(page)) continue;
      const claim = held.get(host);
      if (claim) claim.count += 1;
      else held.set(host, { part: slot.id, page, count: 1 });
    }
  }
  const offered = new Set<string>();
  const settled = new Map<string, Settled<Page>>();
  for (const slot of slots) {
    let pending = 0;
    const pages = slot.pages.map((page): Page => {
      if (!waits(page)) return page;
      const claim = held.get(hostOf(page.url));
      if (claim?.page === page) {
        pending = claim.count > 1 ? claim.count : 0;
        return page;
      }
      const { human: _quiet, ...rest } = page;
      return rest as Page;
    });
    const site = siteOf(slot);
    let need = slot.need;
    if (need && site) {
      if (held.has(site) || read.has(site) || offered.has(site)) need = undefined;
      else offered.add(site);
    }
    settled.set(slot.id, { pages, need, pending });
  }
  return settled;
}
