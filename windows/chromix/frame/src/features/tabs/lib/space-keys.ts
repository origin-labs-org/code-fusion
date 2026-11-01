import { keymap } from "$domain/keymap";
import { acceleratorKeys } from "$shared/lib/accelerator";
import { IS_MAC } from "$shared/platform";

/** The keys that select the space at `index`, as the menu bar shows them. */
export function spaceKeys(index: number): string | null {
  const accelerator = keymap
    .all()
    .find((entry) => entry.id === `space.select.${index + 1}`)?.accelerator;
  return accelerator ? acceleratorKeys(accelerator, IS_MAC).join(IS_MAC ? "" : "+") : null;
}
