import { resolvePluginIconSource } from "@/lib/pluginIconSource.js";
import type { CfPluginReferenceCatalogEntry } from "@origin-ai/cf-shared";
import type { ConversationStoreStatus } from "@/v4/conversationProjectionStore.js";

export function isSessionPluginCatalogReady(
  projectionStatus: ConversationStoreStatus,
  sessionId: string | null,
  snapshotSessionId: string | null | undefined,
): boolean {
  return Boolean(projectionStatus === "live" && sessionId && snapshotSessionId === sessionId);
}

export function hasPluginReferenceUserRows(
  rows: readonly { kind: string; text?: string }[],
): boolean {
  return rows.some((row) => row.kind === "userInput" && row.text?.includes("(plugin://"));
}

export function buildSessionPluginIconMap(
  authority: "session" | "workspace" | null,
  entries: readonly CfPluginReferenceCatalogEntry[],
): ReadonlyMap<string, string> {
  if (authority !== "session") {
    return new Map();
  }

  const iconById = new Map<string, string>();
  for (const entry of entries) {
    const icon = resolvePluginIconSource(entry.pluginId, entry.icon);
    if (icon) {
      iconById.set(entry.pluginId, icon);
    }
  }
  return iconById;
}
