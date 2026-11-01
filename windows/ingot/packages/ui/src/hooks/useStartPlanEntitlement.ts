import type { IUsageStatsService } from "@origin-ai/cf-services";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { buildStartPlanEntitlementOptions } from "@/lib/startPlanEntitlementOptions.js";

export function useStartPlanEntitlement(
  providerId: string,
  service: IUsageStatsService | undefined,
  refreshOnAccess = false,
) {
  const settings = useProviderSettingsView();
  return useUsageEntitlementWithService(service, {
    ...buildStartPlanEntitlementOptions(
      settings.state.status === "ready" ? settings.state.view : null,
      providerId,
    ),
    refreshOnMount: refreshOnAccess,
    mountRefreshReason: "access",
  });
}
