import { preferences, type PreferenceKey } from "$domain/preferences";

const BUSY_RETRY_MS = 60;
const BUSY_RETRIES = 50;

/** One latest-wins write per key, in order: the store takes a single write
 *  at a time, and a theme is only selectable once its seeds have landed. */
export function writer(order: PreferenceKey[], settled: (ok: boolean) => void) {
  const wanted = new Map<PreferenceKey, string>();
  let running = false;

  async function run() {
    if (running) return;
    running = true;
    let ok = true;
    let waits = 0;
    const attempts = new Map<PreferenceKey, number>();
    try {
      for (;;) {
        const key = order.find((k) => wanted.has(k) && wanted.get(k) !== preferences.value(k));
        if (key === undefined) break;
        if (preferences.saving()) {
          if (++waits > BUSY_RETRIES) {
            ok = false;
            break;
          }
          await new Promise((done) => setTimeout(done, BUSY_RETRY_MS));
          continue;
        }
        const value = wanted.get(key)!;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        await preferences.set(key, value);
        if (preferences.saveFailed() || attempt > 3) {
          ok = false;
          break;
        }
      }
    } finally {
      wanted.clear();
      running = false;
      settled(ok);
    }
  }

  return {
    want(values: Partial<Record<PreferenceKey, string>>) {
      for (const [key, value] of Object.entries(values))
        wanted.set(key as PreferenceKey, value as string);
      void run();
    },
  };
}
