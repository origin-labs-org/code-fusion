import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginStoreOrder } from "@origin-ai/cf-shared";
import { useServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

export function usePluginStoreOrder(enabled = true) {
  const { clientConfigService: service } = useServices();
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    order: PluginStoreOrder | null;
  }>();
  const generation = useRef(0);
  const refresh = useCallback(
    async (forceRefresh = false) => {
      const current = ++generation.current;
      try {
        const { pluginStoreOrder: order } = await service.getSnapshot({ forceRefresh });
        if (generation.current === current) setSnapshot({ service, order });
      } catch {
        if (generation.current === current) {
          logger.warn("[PluginStoreOrder] Failed to read configuration; retaining current order");
        }
      }
    },
    [service],
  );

  useEffect(() => {
    if (enabled) void refresh();
    return () => {
      generation.current += 1;
    };
  }, [enabled, refresh]);

  return { order: snapshot?.service === service ? snapshot.order : null, refresh };
}
