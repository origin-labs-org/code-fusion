
const pins = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

const keyOf = (sessionKey: string, toolCallId: string) => `${sessionKey}\u0000${toolCallId}`;

export function getPluginUiManualPin(sessionKey: string, toolCallId: string): boolean | undefined {
  return pins.get(keyOf(sessionKey, toolCallId));
}

export function setPluginUiManualPin(
  sessionKey: string,
  toolCallId: string,
  pinned: boolean | undefined,
): void {
  const key = keyOf(sessionKey, toolCallId);
  if (pins.get(key) === pinned) return;
  if (pinned === undefined) pins.delete(key);
  else pins.set(key, pinned);
  version += 1;
  for (const listener of listeners) listener();
}

export function getPluginUiDisclosureVersion(): number {
  return version;
}

export function subscribePluginUiDisclosure(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPluginUiDisclosureForTest(): void {
  pins.clear();
  listeners.clear();
  version = 0;
}
