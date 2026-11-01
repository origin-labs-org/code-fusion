/** "New Profile…" from the sidebar asks Settings to open on its create sheet. */
let requested = $state(false);

export const requestNew = () => (requested = true);
export function takeNewRequest(): boolean {
  const was = requested;
  requested = false;
  return was;
}
