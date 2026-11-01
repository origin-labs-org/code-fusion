import { useEffect, useState, useReducer } from "react";
import type { PluginUiSurfaceEntry } from "@origin-ai/cf-services";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";
import {
  isPluginManagementChangeRelevant,
  subscribePluginManagementChanges,
} from "@/store/pluginManagementStoreLoading.js";

export interface UsePluginUiSurfacesInput {
  workspacePath: string;
  workspaceIdentity?: string;
  
  enabled?: boolean;
}

export function usePluginUiSurfaces(input: UsePluginUiSurfacesInput): PluginUiSurfaceEntry[] {
  const bridge = useOptionalServices()?.pluginUiBridgeService;
  const [pluginRevision, refresh] = useReducer((value: number) => value + 1, 0);
  const enabled = input.enabled !== false && Boolean(bridge);
  useEffect(() => {
    if (!enabled) return;
    return subscribePluginManagementChanges((change) => {
      if (
        isPluginManagementChangeRelevant(
          {
            workspacePath: input.workspacePath,
            workspaceIdentity: input.workspaceIdentity?.trim() || null,
            authorityKey: null,
            configScope: null,
          },
          change,
        )
      )
        refresh();
    });
  }, [enabled, input.workspacePath, input.workspaceIdentity]);
  const [surfaces, setSurfaces] = useState<PluginUiSurfaceEntry[]>([]);

  useEffect(() => {
    if (!enabled || !bridge) {
      setSurfaces([]);
      return;
    }
    let cancelled = false;
    void bridge
      .listSurfaces({
        workspacePath: input.workspacePath,
        ...(input.workspaceIdentity ? { workspaceIdentity: input.workspaceIdentity } : {}),
      })
      .then((next) => {
        if (!cancelled) setSurfaces(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        logger.warn("[plugin-ui] listSurfaces failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        setSurfaces([]);
      });
    return () => {
      cancelled = true;
    };
  }, [bridge, enabled, input.workspaceIdentity, input.workspacePath, pluginRevision]);

  return surfaces;
}

export function resolvePluginUiSurfaceTitle(
  title: PluginUiSurfaceEntry["title"],
  locale: string,
): string {
  if (typeof title === "string") return title;
  const language = locale.split("-")[0] ?? locale;
  return (
    title[locale] ??
    title[language] ??
    Object.entries(title).find(([key]) =>
      key.toLowerCase().startsWith(language.toLowerCase()),
    )?.[1] ??
    title.en ??
    Object.values(title)[0] ??
    ""
  );
}
