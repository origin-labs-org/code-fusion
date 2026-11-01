//
import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

export function shareStructure<T>(prev: unknown, next: T): T {
  if (Object.is(prev, next)) return prev as T;
  if (Array.isArray(next)) {
    if (!Array.isArray(prev)) return next;
    let allPrev = prev.length === next.length;
    let changed = false;
    const out = next.map((item: unknown, index) => {
      const shared = index < prev.length ? shareStructure(prev[index], item) : item;
      if (shared !== item) changed = true;
      if (index >= prev.length || shared !== prev[index]) allPrev = false;
      return shared;
    });
    if (allPrev) return prev as T;
    return (changed ? out : next) as T;
  }
  if (isPlainObject(next)) {
    if (!isPlainObject(prev)) return next;
    const keys = Object.keys(next);
    let allPrev = keys.length === Object.keys(prev).length;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      const item = next[key];
      const hasPrev = Object.hasOwn(prev, key);
      const shared = hasPrev ? shareStructure(prev[key], item) : item;
      if (shared !== item) changed = true;
      if (!hasPrev || shared !== prev[key]) allPrev = false;
      out[key] = shared;
    }
    if (allPrev) return prev as T;
    return (changed ? out : next) as T;
  }
  return (typeof next === "string" && prev === next ? prev : next) as T;
}

export class ConversationRowPool {
  private readonly rows = new Map<string, WeakRef<ConversationRow>>();
  private readonly registry = new FinalizationRegistry<{
    key: string;
    ref: WeakRef<ConversationRow>;
  }>(({ key, ref }) => {
    if (this.rows.get(key) === ref) this.rows.delete(key);
  });

  private key(topic: string, rowId: number): string {
    return `${topic}\u0000${rowId}`;
  }

  
  remember(topic: string, row: ConversationRow): void {
    const key = this.key(topic, row.rowId);
    if (this.rows.get(key)?.deref() === row) return;
    const ref = new WeakRef(row);
    this.rows.set(key, ref);
    this.registry.register(row, { key, ref });
  }

  shareRow(topic: string, row: ConversationRow): ConversationRow {
    const prev = this.rows.get(this.key(topic, row.rowId))?.deref();
    const shared = prev ? shareStructure(prev, row) : row;
    this.remember(topic, shared);
    return shared;
  }

  
  shareWindow(
    topic: string,
    rows: ConversationRow[],
    prevWindow?: readonly ConversationRow[],
  ): ConversationRow[] {
    let allPrev = prevWindow !== undefined && prevWindow.length === rows.length;
    let changed = false;
    const out = rows.map((row, index) => {
      const shared = this.shareRow(topic, row);
      if (shared !== row) changed = true;
      if (allPrev && shared !== prevWindow![index]) allPrev = false;
      return shared;
    });
    if (allPrev) return prevWindow as ConversationRow[];
    return changed ? out : rows;
  }
}
