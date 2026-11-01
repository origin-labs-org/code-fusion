import {
  EMPTY_PLUGIN_UI_INSTANCE_DERIVATION,
  type PluginUiInstanceDerivation,
  type PluginUiRowDisposition,
} from "../domain/pluginUiInstancePolicy.js";

const derivations = new Map<string, PluginUiInstanceDerivation>();
const listeners = new Set<() => void>();

export function setPluginUiInstanceDerivation(
  sessionKey: string,
  derivation: PluginUiInstanceDerivation,
): void {
  if (derivations.get(sessionKey) === derivation) return;
  derivations.set(sessionKey, derivation);
  for (const listener of listeners) listener();
}

export function getPluginUiRowDisposition(
  sessionKey: string,
  toolCallId: string,
): PluginUiRowDisposition | undefined {
  return (derivations.get(sessionKey) ?? EMPTY_PLUGIN_UI_INSTANCE_DERIVATION).byToolCallId[
    toolCallId
  ];
}

export function subscribePluginUiInstances(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetPluginUiInstancesForTest(): void {
  derivations.clear();
  listeners.clear();
}
