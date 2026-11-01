import { useEffect, useMemo, useRef } from "react";
import type { ICodingPlanSubscriptionService, ICfAgentService } from "@origin-ai/cf-services";
import type { DynamicWorkflowMode } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import {
  useDynamicWorkflowAvailabilityStore,
  type DynamicWorkflowAvailabilitySnapshot,
} from "@/store/dynamicWorkflowAvailabilityStore.js";

export function useDynamicWorkflowAvailability(): DynamicWorkflowAvailabilitySnapshot {
  const status = useDynamicWorkflowAvailabilityStore((state) => state.status);
  const enabled = useDynamicWorkflowAvailabilityStore((state) => state.enabled);
  const config = useDynamicWorkflowAvailabilityStore((state) => state.config);
  return useMemo(() => ({ status, enabled, config }), [config, enabled, status]);
}

export function useDynamicWorkflowAvailabilityLoader(
  service: ICodingPlanSubscriptionService,
): void {
  const ensureLoaded = useDynamicWorkflowAvailabilityStore((state) => state.ensureLoaded);
  useEffect(() => {
    void ensureLoaded(service);
  }, [ensureLoaded, service]);
}

export function useDynamicWorkflowUserModeSync(params: {
  settingsLoaded: boolean;
  userMode: DynamicWorkflowMode | undefined;
  cfAgentService: Pick<ICfAgentService, "syncDynamicWorkflowUserMode">;
  codingPlanSubscriptionService: ICodingPlanSubscriptionService;
}): void {
  const { settingsLoaded, userMode, cfAgentService, codingPlanSubscriptionService } = params;
  const reload = useDynamicWorkflowAvailabilityStore((state) => state.reload);
  const observedRef = useRef<{ userMode: DynamicWorkflowMode | undefined } | null>(null);
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!settingsLoaded) return;
    const observed = observedRef.current;
    observedRef.current = { userMode };
    if (observed === null || observed.userMode === userMode) return;
    chainRef.current = chainRef.current.then(async () => {
      try {
        await cfAgentService.syncDynamicWorkflowUserMode(userMode ? { mode: userMode } : {});
      } catch (error) {
        logger.warn("[dynamic-workflow] 用户选择同步到 Host 失败", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await reload(codingPlanSubscriptionService);
    });
  }, [codingPlanSubscriptionService, reload, settingsLoaded, userMode, cfAgentService]);
}
