import { isBuiltinModelProviderId, isStartPlanModelProviderId } from "@origin-ai/cf-shared";
import type { ProviderSettingsView } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";

export interface AccountConnectionLoss {
  readonly providerId: string;
  readonly connectionKey: string;
  
  readonly isCurrent: () => boolean;
}

export function createAccountConnectionRefreshObserver(
  notify: (event: AccountConnectionLoss) => void | Promise<void>,
) {
  let disposed = false;
  let latestRevision = -1;
  let key: string | undefined;
  let previous: string | undefined;
  let generation = 0;
  return {
    async accept(view: ProviderSettingsView) {
      if (disposed || view.revision < latestRevision) return;
      latestRevision = view.revision;
      const current = view.providers.find(
        (p) =>
          p.accountState?.current === true &&
          isBuiltinModelProviderId(p.providerId) &&
          !isStartPlanModelProviderId(p.providerId),
      );
      const nextKey = current?.accountState?.connectionKey;
      const next = current?.accountState?.availability;
      if (nextKey !== key) {
        key = nextKey;
        previous = undefined;
        generation++;
      }
      if (!key || !current || !next || next === "unknown") return;
      const lost = (previous === "available" || previous === "pending") && next === "unavailable";
      if (next !== previous) generation++;
      previous = next;
      if (!lost) return;
      const eventGeneration = generation;
      try {
        await notify({
          providerId: current.providerId,
          connectionKey: key,
          isCurrent: () =>
            !disposed && generation === eventGeneration && previous === "unavailable",
        });
      } catch (error) {
        logger.lifecycle.warn("[AccountConnection] Failed to generate plan expiration notice; keeping current selection", { error });
      }
    },
    invalidate() {
      key = undefined;
      previous = undefined;
      generation++;
    },
    dispose() {
      disposed = true;
      generation++;
    },
  };
}
