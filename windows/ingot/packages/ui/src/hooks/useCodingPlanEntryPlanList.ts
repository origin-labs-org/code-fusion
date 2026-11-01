import { useCallback, useEffect, useState } from "react";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { useCfStore } from "@/store/StoreProvider.js";
import { useCodingPlanEntitlements } from "@/settings/model-provider-section/useCodingPlanEntitlements.js";
import { BUILTIN_MODEL_PROVIDER_IDS, type EnterpriseCodingPlanPricingProduct } from "@origin-ai/cf-shared";
import { buildOwnedEntryPlanList } from "@/lib/codingPlanOwnedEntryPlans.js";
import { resolveAccountProviderInspectionAccess } from "@/lib/accountProviderAccess.js";
import { logger } from "@/logger.js";

export interface CodingPlanEntryInventory {
  entryPlanList: string;
  status: "loading" | "error" | "ready";
  retry: () => void;
}

export function useCodingPlanEntryPlanList(): CodingPlanEntryInventory {
  const { state, reload } = useProviderSettingsView();
  const providerSettingsView = state.status === "ready" ? state.view : null;
  const loading = state.status === "loading";
  const { credentialService, codingPlanSubscriptionService } = useServices();
  const user = useCfStore((state) => state.user);
  const { entitlements, refresh } = useCodingPlanEntitlements({
    providerSettingsView,
    suppressProviderFingerprintAutoRefresh: true,
  });
  const [generation, setGeneration] = useState(0);
  const retry = useCallback(() => {
    if (state.status === "error") reload();
    setGeneration((value) => value + 1);
  }, [state.status, reload]);
  const [teams, setTeams] = useState<{
    user: typeof user;
    view: typeof providerSettingsView;
    sources: { token: string | null; products: EnterpriseCodingPlanPricingProduct[] | null }[];
    generation: number;
  } | null>(null);
  useEffect(() => {
    if (!providerSettingsView) return;
    let cancelled = false;
    void Promise.all([
      refresh({ force: true, silent: true }),
      Promise.all(
        (["bigmodel", "zai"] as const).map(async (family) => {
          let token: string | null = null;
          try {
            token = (await credentialService.load(`oauth:${family}:access_token`))?.trim() || null;
            if (!token) return { token, products: [] };
            const result = await codingPlanSubscriptionService.getEnterprisePricing({
              authenticated: true,
              family,
            });
            return { token, products: result.productList };
          } catch (error) {
            logger.warn("[purchaseTelemetry] 读取团队套餐失败", { family, error });
            return { token, products: null };
          }
        }),
      ),
    ]).then(([, sources]) => {
      if (!cancelled)
        setTeams((previous) => ({
          user,
          view: providerSettingsView,
          generation,
          sources: sources.map((source, index) => {
            const cached = previous?.sources[index];
            return source.products === null &&
              source.token &&
              previous?.user === user &&
              cached?.token === source.token
              ? { ...source, products: cached.products }
              : source;
          }),
        }));
    });
    return () => {
      cancelled = true;
    };
  }, [
    credentialService,
    codingPlanSubscriptionService,
    user,
    providerSettingsView,
    generation,
    loading,
    refresh,
  ]);
  const sameIdentity = teams?.user === user && teams.view === providerSettingsView;
  const current = sameIdentity && teams.generation === generation;
  const usableTeams = sameIdentity && teams.sources.every((source) => source.products !== null);
  const planIds: readonly string[] = [
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan,
    BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan,
    BUILTIN_MODEL_PROVIDER_IDS.bigmodelStartPlan,
    BUILTIN_MODEL_PROVIDER_IDS.zaiStartPlan,
  ];
  const required = planIds
    .filter((providerId) =>
      resolveAccountProviderInspectionAccess(providerSettingsView, providerId),
    )
    .map((providerId) => entitlements[providerId]);
  const missing = required.filter((item) => {
    const snapshot = item?.snapshot;
    return (
      !snapshot ||
      (snapshot.unavailableReason !== "no_plan" &&
        (!snapshot.authenticated || snapshot.unavailableReason))
    );
  });
  const pending = loading || !current || missing.some((item) => item?.loading);
  const failed = !usableTeams || missing.length > 0;
  const status =
    state.status === "error" ? "error" : pending ? "loading" : failed ? "error" : "ready";
  useEffect(() => {
    logger.debug("[purchaseTelemetry] 套餐入口查询状态", {
      status,
      configuredSources: required.length,
      generation,
    });
  }, [status, required.length, generation]);
  return {
    status,
    retry,
    entryPlanList:
      status === "ready"
        ? buildOwnedEntryPlanList({
            snapshots: required.map((item) => item?.snapshot),
            teamProducts: teams?.sources.flatMap((source) => source.products ?? []) ?? [],
          })
        : "",
  };
}
