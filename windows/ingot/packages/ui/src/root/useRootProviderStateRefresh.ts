import { useCallback } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";

type RootProviderStateServices = Pick<
  IServiceAccessor,
  "providerSettingsService"
>;

export async function refreshRootProviderState(
  services: RootProviderStateServices,
): Promise<void> {
  try {
    await services.providerSettingsService.refresh(
      "root-provider-state-refresh",
    );
  } catch (error) {
    logger.error("[Root] 刷新 Provider Runtime 失败:", error);
  }
}

export function useRootProviderStateRefresh(services: IServiceAccessor) {
  return useCallback(
    () => refreshRootProviderState(services),
    [services.providerSettingsService],
  );
}
