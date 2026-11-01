//
//

export const OFFICIAL_MARKETPLACE_AUTO_REFRESH_INTERVAL_MS = 10 * 60_000;

const lastAttemptAtByMarketplace = new Map<string, number>();

function parseTimestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

export function shouldAutoRefreshMarketplace(params: {
  lastUpdated?: string;
  lastAttemptAt?: number;
  now: number;
}): boolean {
  const lastUpdatedAt = parseTimestamp(params.lastUpdated);
  const lastKnownAt = Math.max(lastUpdatedAt ?? -Infinity, params.lastAttemptAt ?? -Infinity);
  return params.now - lastKnownAt >= OFFICIAL_MARKETPLACE_AUTO_REFRESH_INTERVAL_MS;
}

export function claimMarketplaceAutoRefresh(
  marketplaceId: string,
  lastUpdated: string | undefined,
  now: number = Date.now(),
): boolean {
  const shouldRefresh = shouldAutoRefreshMarketplace({
    lastUpdated,
    lastAttemptAt: lastAttemptAtByMarketplace.get(marketplaceId),
    now,
  });
  if (shouldRefresh) {
    lastAttemptAtByMarketplace.set(marketplaceId, now);
  }
  return shouldRefresh;
}

export function resetMarketplaceAutoRefreshForTests(): void {
  lastAttemptAtByMarketplace.clear();
}
