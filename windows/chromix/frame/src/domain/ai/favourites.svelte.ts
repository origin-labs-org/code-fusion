import { preferences } from "$domain/preferences";
import { pause } from "$shared/lib/observe";

const KEY = "work.favourite-models";
const ids = (stored: string) => stored.split("\n").filter(Boolean);

/** What the person has starred, shown ahead of the store's readback. */
let wanted = $state.raw<string[] | null>(null);
let writing = false;

/** The models starred in the picker, in the order they were starred. */
export const favourites = () => wanted ?? ids(preferences.value(KEY));

async function flush() {
  if (writing) return;
  writing = true;
  try {
    for (let turn = 0; wanted && turn < 50; turn++) {
      const next = wanted.join("\n");
      if (next === preferences.value(KEY)) break;
      if (preferences.saving()) {
        await pause(40);
        continue;
      }
      await preferences.set(KEY, next);
      if (preferences.saveFailed()) break;
    }
  } finally {
    wanted = null;
    writing = false;
  }
}

export function toggleFavourite(id: string) {
  const now = favourites();
  wanted = now.includes(id) ? now.filter((known) => known !== id) : [...now, id];
  void flush();
}
