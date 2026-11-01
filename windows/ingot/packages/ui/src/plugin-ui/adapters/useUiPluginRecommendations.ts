import { useEffect, useState } from "react";
import type { ClientConfigSnapshot } from "@origin-ai/cf-shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { logger } from "@/logger.js";

export function useUiPluginRecommendations(enabled: boolean) {
  const service = useOptionalServices()?.clientConfigService;
  const [snapshot, setSnapshot] = useState<{
    service: typeof service;
    recommendations: ClientConfigSnapshot["uiPluginRecommendations"];
  }>();
  useEffect(() => {
    let active = true;
    setSnapshot(undefined);
    if (enabled && service) {
      void service.getSnapshot().then(
        ({ uiPluginRecommendations }) => {
          if (active) setSnapshot({ service, recommendations: uiPluginRecommendations ?? [] });
        },
        () => {
          if (active) {
            setSnapshot({ service, recommendations: [] });
            logger.warn("[plugin-ui] 推荐配置读取失败");
          }
        },
      );
    }
    return () => {
      active = false;
    };
  }, [enabled, service]);
  const current = enabled && snapshot?.service === service ? snapshot : undefined;
  return {
    recommendations: current?.recommendations ?? [],
    loading: enabled && Boolean(service) && !current,
  };
}
