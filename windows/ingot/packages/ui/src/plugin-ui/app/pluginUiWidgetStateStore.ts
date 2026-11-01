
const states = new Map<string, unknown>();

export function getPluginUiWidgetState(key: string): unknown {
  return states.get(key);
}

export function setPluginUiWidgetState(key: string, widgetState: unknown): void {
  states.set(key, widgetState);
}

export function clearPluginUiWidgetState(key: string): void {
  states.delete(key);
}

export function resetPluginUiWidgetStateForTest(): void {
  states.clear();
}
