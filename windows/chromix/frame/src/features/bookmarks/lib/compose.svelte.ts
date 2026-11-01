/** What the panel's header asked it to start: a link by address, or a folder.
 *  Consumed once, by the panel that is showing. */
type Kind = "link" | "folder";

let pending = $state<Kind | null>(null);

export const requested = () => pending;

export function request(kind: Kind) {
  pending = kind;
}

export function take(): Kind | null {
  const kind = pending;
  pending = null;
  return kind;
}
