import { useEffect } from "react";
import type { AppSettings } from "@origin-ai/cf-shared";
import { useServices } from "@/hooks/useServices.js";
import { useOffPeakTaskStore } from "@/store/offPeakTaskStore.js";

export function useOffPeakEligibility(
  settings: AppSettings | null | undefined,
  registryRevision: number | undefined,
): void {
  const { offPeakTaskService, codingPlanSubscriptionService } = useServices();
  const initialize = useOffPeakTaskStore((state) => state.initialize);
  const refresh = useOffPeakTaskStore((state) => state.refreshCodingPlanSupport);
  const family = settings?.providerFamilyDomain;
  const connection = family ? settings?.providerFamilyConnectionSelections?.[family] : undefined;
  const freshnessKey = settings
    ? JSON.stringify([registryRevision, family, connection])
    : undefined;

  useEffect(() => {
    void initialize({ offPeakTaskService, codingPlanSubscriptionService });
  }, [initialize, offPeakTaskService, codingPlanSubscriptionService]);

  useEffect(() => {
    if (freshnessKey === undefined) return;
    void refresh(offPeakTaskService, freshnessKey);
  }, [freshnessKey, offPeakTaskService, refresh]);
}
