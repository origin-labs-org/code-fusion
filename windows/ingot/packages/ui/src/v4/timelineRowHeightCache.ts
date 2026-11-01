//
//

export const DEFAULT_ROW_HEIGHT_ESTIMATE_PX = 72;

export const MAX_ROW_HEIGHT_CACHE_ENTRIES = 4000;

export type TimelineRowHeightCacheKey = string | number;

export class TimelineRowHeightCache {
  private readonly sizes = new Map<TimelineRowHeightCacheKey, number>();

  constructor(
    private readonly maxEntries: number = MAX_ROW_HEIGHT_CACHE_ENTRIES,
  ) {}

  get size(): number {
    return this.sizes.size;
  }

  
  set(key: TimelineRowHeightCacheKey, heightPx: number): void {
    if (!Number.isFinite(heightPx) || heightPx <= 0) {
      return;
    }
    this.sizes.delete(key);
    this.sizes.set(key, heightPx);
    while (this.sizes.size > this.maxEntries) {
      const oldest = this.sizes.keys().next();
      if (oldest.done) break;
      this.sizes.delete(oldest.value);
    }
  }

  get(key: TimelineRowHeightCacheKey): number | undefined {
    return this.sizes.get(key);
  }

  
  estimate(
    key: TimelineRowHeightCacheKey | undefined,
    fallbackPx: number = DEFAULT_ROW_HEIGHT_ESTIMATE_PX,
  ): number {
    if (key === undefined) return fallbackPx;
    return this.sizes.get(key) ?? fallbackPx;
  }

  
  clear(): void {
    this.sizes.clear();
  }
}
