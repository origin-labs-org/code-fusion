import { surface } from "$domain/surface";
import { expandBriefly } from "$session/sidebar-mode.svelte";
import * as tools from "$session/tools.svelte";

/** The spaces list, "New Space…" or "Edit Space…" asked for from a menu,
 *  waiting for the switcher, with the release of a column expanded only to show it. */
type Request = { kind: "list" | "new" | "edit"; release: (() => void) | null };

let request = $state.raw<Request | null>(null);
let handled = 0;

export const pending = () => request;
export function ask(kind: Request["kind"], release: (() => void) | null = null) {
  request?.release?.();
  request = { kind, release };
}
export function take(): Request | null {
  const taken = request;
  request = null;
  return taken;
}
/** Each native command is handled once, by whichever shape of the column has it. */
export function claim(seq: number): boolean {
  if (seq <= handled) return false;
  handled = seq;
  return true;
}

/** The full spaces flow asked for from the rail: the column opens to its full
 *  shape in place, shows it, and closes back to the rail when it is done. */
export function openInColumn(kind: Request["kind"]) {
  tools.close();
  if (surface.currentPage() !== null) void surface.close();
  ask(kind, expandBriefly());
}
