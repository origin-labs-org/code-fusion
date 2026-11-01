import { create } from "zustand";
import type { DynamicWorkflowClientConfig } from "@origin-ai/cf-shared";
import type { ICodingPlanSubscriptionService } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";

// ============================================================
// ============================================================
//

export type DynamicWorkflowAvailabilityStatus = "loading" | "ready";

export interface DynamicWorkflowAvailabilitySnapshot {
  readonly status: DynamicWorkflowAvailabilityStatus;
  
  readonly enabled: boolean;
  
  readonly config: DynamicWorkflowClientConfig | null;
}

interface DynamicWorkflowAvailabilityState extends DynamicWorkflowAvailabilitySnapshot {
  
  ensureLoaded(service: ICodingPlanSubscriptionService): Promise<void>;
  
  refresh(service: ICodingPlanSubscriptionService): Promise<void>;
  
  reload(service: ICodingPlanSubscriptionService): Promise<void>;
}

const INITIAL_SNAPSHOT: DynamicWorkflowAvailabilitySnapshot = {
  status: "loading",
  enabled: false,
  config: null,
};

let inFlight: Promise<void> | null = null;

let settledService: ICodingPlanSubscriptionService | null = null;

type PublishSnapshot = (snapshot: DynamicWorkflowAvailabilitySnapshot) => void;

async function loadDynamicWorkflowConfig(
  service: ICodingPlanSubscriptionService,
  options: { forceRefresh?: boolean },
  publish: PublishSnapshot,
): Promise<void> {
  try {
    const config = await service.getDynamicWorkflowClientConfig(options);
    publish({ status: "ready", enabled: config.enabled === true, config });
  } catch (error) {
    logger.warn(
      "[dynamic-workflow] Failed to read canary snapshot; treating as cache miss",
      error instanceof Error ? error.message : String(error),
    );
    publish({ status: "ready", enabled: false, config: null });
  } finally {
    settledService = service;
  }
}

export const useDynamicWorkflowAvailabilityStore = create<DynamicWorkflowAvailabilityState>(
  (set, get) => ({
    ...INITIAL_SNAPSHOT,

    ensureLoaded(service): Promise<void> {
      if (settledService === service) return Promise.resolve();
      if (inFlight) {
        return inFlight.then(() => get().ensureLoaded(service));
      }
      const run = loadDynamicWorkflowConfig(service, {}, set).finally(() => {
        if (inFlight === run) inFlight = null;
      });
      inFlight = run;
      return run;
    },

    refresh(service): Promise<void> {
      return loadDynamicWorkflowConfig(service, { forceRefresh: true }, set);
    },

    reload(service): Promise<void> {
      return loadDynamicWorkflowConfig(service, {}, set);
    },
  }),
);

export function resetDynamicWorkflowAvailabilityStoreForTests(): void {
  inFlight = null;
  settledService = null;
  useDynamicWorkflowAvailabilityStore.setState({ ...INITIAL_SNAPSHOT });
}
