import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getModelProviderFamilySpec,
  type CodingPlanStaticTeamProduct,
  type EnterpriseCodingPlanPricingResponse,
  type ProviderFamilyDomain,
} from "@origin-ai/cf-shared";
import { useOptionalServices } from "@/hooks/useServices.js";
import { isRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { logger } from "@/logger.js";
import {
  resolveEnterpriseCodingPlanProductList,
  type EnterpriseCodingPlanProductDisplay,
} from "@/settings/model-provider-section/enterpriseCodingPlanProducts.js";
import { normalizeErrorMessage } from "@/settings/model-provider-section/useCodingPlanProducts.js";

interface EnterpriseCodingPlanProductsState {
  snapshot: EnterpriseCodingPlanProductsSnapshot | null;
  loading: boolean;
  error: string | null;
}

export interface EnterpriseCodingPlanProductsSnapshot {
  productList: EnterpriseCodingPlanProductDisplay[];
  raw: EnterpriseCodingPlanPricingResponse;
  authenticated: boolean;
  
  staticProductIds?: string[];
}

export function shouldRetainEnterprisePricingSnapshotForRefresh(
  snapshot: EnterpriseCodingPlanProductsSnapshot | null,
  authenticated: boolean,
): boolean {
  return snapshot?.authenticated === authenticated;
}

export function resolveEnterprisePricingFailureSnapshot({
  currentSnapshot,
  authenticated,
  staticProducts,
  family = "bigmodel",
}: {
  currentSnapshot: EnterpriseCodingPlanProductsSnapshot | null;
  authenticated: boolean;
  staticProducts: CodingPlanStaticTeamProduct[] | undefined;
  family?: ProviderFamilyDomain;
}): EnterpriseCodingPlanProductsSnapshot | null {
  if (shouldRetainEnterprisePricingSnapshotForRefresh(currentSnapshot, authenticated)) {
    return currentSnapshot;
  }
  if (!Array.isArray(staticProducts)) {
    return null;
  }
  const raw: EnterpriseCodingPlanPricingResponse = { productList: [] };
  return {
    raw,
    productList: tagEnterpriseProductsFamily(
      resolveEnterpriseCodingPlanProductList(staticProducts, raw.productList),
      family,
    ),
    authenticated,
  };
}

function tagEnterpriseProductsFamily(
  products: EnterpriseCodingPlanProductDisplay[],
  family: ProviderFamilyDomain,
): EnterpriseCodingPlanProductDisplay[] {
  return products.map((product) => ({ ...product, family }));
}

export function useEnterpriseCodingPlanProducts({
  enabled,
  authenticated,
  family = "bigmodel",
  staticOnly = false,
}: {
  enabled: boolean;
  
  staticOnly?: boolean;
  authenticated: boolean;
  family?: ProviderFamilyDomain;
}) {
  const services = useOptionalServices();
  const service = services?.codingPlanSubscriptionService;
  const authScope = useCfStoreWithDefault(
    (state) => (state.user ? state.user.id + ":" + state.authSessionSeq : "signed-out"),
    "unscoped",
  );
  const scope = useMemo(() => ({}), [service, family, authenticated, authScope, staticOnly]);
  const owner = useRef({ scope, enabled, mounted: true });
  owner.current = { scope, enabled, mounted: true };
  const codingPlanProviderId = getModelProviderFamilySpec(family).individualCodingPlanProviderId;
  const [owned, setOwned] = useState<{ scope: object; state: EnterpriseCodingPlanProductsState }>({
    scope,
    state: {
      snapshot: null,
      loading: enabled,
      error: null,
    },
  });
  const state =
    owned.scope === scope ? owned.state : { snapshot: null, loading: enabled, error: null };
  const setState = useCallback(
    (
      next:
        | EnterpriseCodingPlanProductsState
        | ((state: EnterpriseCodingPlanProductsState) => EnterpriseCodingPlanProductsState),
    ) => {
      if (owner.current.scope !== scope || !owner.current.mounted) return;
      setOwned((previous) => ({
        scope,
        state:
          typeof next === "function"
            ? next(
                previous.scope === scope
                  ? previous.state
                  : { snapshot: null, loading: enabled, error: null },
              )
            : next,
      }));
    },
    [scope, enabled],
  );

  const refresh = useCallback(
    async (_options?: { force?: boolean }) => {
      if (!enabled) {
        setState((current) => ({
          snapshot: current.snapshot,
          loading: false,
          error: null,
        }));
        return;
      }
      if (!service) {
        setState({
          snapshot: null,
          loading: false,
          error: "service_unavailable",
        });
        return;
      }

      setState((current) => ({
        snapshot: shouldRetainEnterprisePricingSnapshotForRefresh(current.snapshot, authenticated)
          ? current.snapshot
          : null,
        loading: true,
        error: null,
      }));

      try {
        const [staticResult, pricingResult] = await Promise.allSettled([
          service.getStaticTeamProducts(),
          staticOnly
            ? Promise.resolve<EnterpriseCodingPlanPricingResponse>({ productList: [] })
            : service.getEnterprisePricing({ authenticated, family }),
        ]);
        if (owner.current.scope !== scope || !owner.current.enabled || !owner.current.mounted)
          return;
        const staticProducts =
          staticResult.status === "fulfilled"
            ? Object.prototype.hasOwnProperty.call(staticResult.value, codingPlanProviderId)
              ? staticResult.value[codingPlanProviderId]
              : undefined
            : undefined;
        const raw: EnterpriseCodingPlanPricingResponse =
          pricingResult.status === "fulfilled" ? pricingResult.value : { productList: [] };
        const pricingError = pricingResult.status === "rejected" ? pricingResult.reason : null;
        if (pricingError) {
          const message = normalizeErrorMessage(pricingError);
          setState((current) => ({
            snapshot: resolveEnterprisePricingFailureSnapshot({
              currentSnapshot: current.snapshot,
              authenticated,
              staticProducts,
              family,
            }),
            loading: false,
            error: message,
          }));
          if (!isRemoteWorkspaceDisconnectedError(pricingError)) {
            logger.warn("[useEnterpriseCodingPlanProducts] Failed to read enterprise real-time pricing", {
              authenticated,
              error: message,
            });
          }
          return;
        }
        setState({
          snapshot: {
            raw,
            staticProductIds: staticProducts?.map((product) => product.productId) ?? [],
            productList: tagEnterpriseProductsFamily(
              resolveEnterpriseCodingPlanProductList(staticProducts, raw.productList),
              family,
            ),
            authenticated,
          },
          loading: false,
          error: pricingError ? normalizeErrorMessage(pricingError) : null,
        });
        if (
          staticResult.status === "rejected" &&
          !isRemoteWorkspaceDisconnectedError(staticResult.reason)
        ) {
          logger.warn("[useEnterpriseCodingPlanProducts] Failed to read team static configuration; falling back to real-time pricing", {
            authenticated,
            error: normalizeErrorMessage(staticResult.reason),
          });
        }
      } catch (error) {
        const message = normalizeErrorMessage(error);
        if (!isRemoteWorkspaceDisconnectedError(error)) {
          logger.warn("[useEnterpriseCodingPlanProducts] Failed to read enterprise Coding Plan plans", {
            authenticated,
            error: message,
          });
        }
        setState((current) => ({
          snapshot: shouldRetainEnterprisePricingSnapshotForRefresh(current.snapshot, authenticated)
            ? current.snapshot
            : null,
          loading: false,
          error: message,
        }));
      }
    },
    [authenticated, codingPlanProviderId, enabled, family, service, staticOnly, scope, setState],
  );

  useEffect(() => {
    owner.current.mounted = true;
    void refresh();
    return () => {
      owner.current.mounted = false;
    };
  }, [refresh]);

  return useMemo(
    () => ({
      ...state,
      refresh,
    }),
    [refresh, state],
  );
}
