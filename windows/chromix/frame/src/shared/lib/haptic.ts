import { commands, type HapticKind } from "$shared/ipc/bindings";

const MIN_GAP = 40;
let last = 0;

/** Trackpad feedback where a gesture means something. Native rate limits too;
 *  failing to play is never worth a message. */
export function haptic(kind: HapticKind) {
  const now = performance.now();
  if (now - last < MIN_GAP) return;
  last = now;
  try {
    void commands.haptic(kind).catch(() => undefined);
  } catch {
    // No native side to play it.
  }
}
