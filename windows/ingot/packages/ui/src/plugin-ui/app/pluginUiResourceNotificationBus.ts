import type { McpAppInstance } from "@origin-ai/cf-shared/mcp-apps";
import type { PluginUiInstanceDelta } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { PluginUiResourceNotificationTarget } from "../contract.js";
import { buildPluginUiSessionKey } from "../contract.js";
import type { PluginUiHostControllerDeps, PluginUiHostScope } from "./pluginUiHostController.js";

const targets = new Map<string, PluginUiResourceNotificationTarget>();

function buildKey(
  sessionKey: string,
  pluginId: string,
  scopeId: string,
  generation: number,
  instance: McpAppInstance,
) {
  return JSON.stringify([
    sessionKey,
    pluginId,
    scopeId,
    generation,
    instance.runtimeId,
    instance.appIdentity,
    instance.token,
  ]);
}

export function registerPluginUiResourceTarget(
  sessionKey: string,
  pluginId: string,
  scopeId: string,
  generation: number,
  target: PluginUiResourceNotificationTarget,
  instance: McpAppInstance,
): () => void {
  const key = buildKey(sessionKey, pluginId, scopeId, generation, instance);
  targets.set(key, target);
  return () => {
    if (targets.get(key) === target) targets.delete(key);
  };
}

export function dispatchPluginUiResourceDelta(
  sessionKey: string,
  delta: PluginUiInstanceDelta,
): number {
  let delivered = 0;
  for (const subscriber of delta.subscribers) {
    const target = targets.get(
      buildKey(
        sessionKey,
        delta.serverName,
        subscriber.scopeId,
        subscriber.generation,
        subscriber.instance,
      ),
    );
    if (!target) continue;
    delivered += 1;
    if (delta.op === "pluginUi.instanceClosed") target.notifyInstanceClosed?.();
    else if (delta.op === "pluginUi.resourceUpdated") target.notifyResourceUpdated(delta.uri);
    else if (delta.op === "pluginUi.appToolCall") {
      target.notifyAppToolCall({
        activity: delta.activity,
        cancelled: delta.cancelled,
        callId: delta.callId,
        toolName: delta.toolName,
        arguments: delta.arguments,
      });
    } else target.notifyResourceListChanged();
  }
  return delivered;
}

export function createPluginUiResourceNotificationRegistrar(
  scope: PluginUiHostScope,
  pluginId: string,
): NonNullable<PluginUiHostControllerDeps["resourceNotifications"]> {
  const sessionKey = buildPluginUiSessionKey(scope);
  return {
    register: (generation, target, instance) =>
      registerPluginUiResourceTarget(
        sessionKey,
        pluginId,
        instance.token,
        generation,
        target,
        instance,
      ),
  };
}

export function resetPluginUiResourceTargetsForTest(): void {
  targets.clear();
}
