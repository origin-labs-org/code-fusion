import { useCallback } from "react";
import { resolveModelProviderFamilyIdByProviderId } from "@origin-ai/cf-shared";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useServices } from "@/hooks/useServices.js";
import { type CodingPlanProviderId } from "@/settings/model-provider-section/constants.js";
import { resolveCodingPlanUpgradeProductsProviderId } from "@/settings/model-provider-section/codingPlanPricingCards.js";
import { normalizeCodingPlanProviderId } from "@/settings/model-provider-section/codingPlanPurchaseAuth.js";
import { useCodingPlanEntitlements } from "@/settings/model-provider-section/useCodingPlanEntitlements.js";
import {
  beginCodingPlanUpgradeLogin,
  resolvePendingCodingPlanUpgradeAfterLogin,
  type CodingPlanUpgradeDialogTarget,
} from "@/settings/codingPlanUpgradeLoginRecovery.js";
import { CodingPlanEmbeddedWebviewDialog } from "@/settings/CodingPlanEmbeddedWebviewDialog.js";
import { logger } from "@/logger.js";

export { isCodingPlanPurchaseAuthPending } from "@/settings/model-provider-section/codingPlanPurchaseAuth.js";
export {
  beginCodingPlanUpgradeLogin,
  resolvePendingCodingPlanUpgradeAfterLogin,
} from "@/settings/codingPlanUpgradeLoginRecovery.js";
export type { CodingPlanUpgradeDialogTarget } from "@/settings/codingPlanUpgradeLoginRecovery.js";

interface CodingPlanUpgradeDialogProps {
  target?: CodingPlanUpgradeDialogTarget;
  onClose: () => void;
  onOpenResult?: (opened: boolean) => void;
  onReopen?: (target: CodingPlanUpgradeDialogTarget) => void;
}

export async function refreshCodingPlanUpgradeCompletion(params: {
  productsProviderId: CodingPlanProviderId | null;
  providerId: CodingPlanProviderId | null;
  refreshCodingPlanEntitlements: () => Promise<unknown> | unknown;
  refreshProviderState: () => Promise<unknown> | unknown;
  refreshTeamPlanProducts?: () => Promise<unknown> | unknown;
}) {
  await Promise.all([
    params.refreshProviderState(),
    params.refreshCodingPlanEntitlements(),
    params.refreshTeamPlanProducts?.(),
  ]);
}

export async function closeAndRefreshCodingPlanUpgradeFromWebview(params: {
  onClose: () => void;
  refresh: () => Promise<unknown> | unknown;
  onRefreshError?: (error: unknown) => void;
}) {
  params.onClose();
  try {
    await params.refresh();
  } catch (error) {
    params.onRefreshError?.(error);
  }
}

export function CodingPlanUpgradeDialog({ target, onClose, onOpenResult }: CodingPlanUpgradeDialogProps) {
  const { providerSettingsService, credentialService, codingPlanSubscriptionService } =
    useServices();
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  const { refresh: refreshCodingPlanEntitlements } = useCodingPlanEntitlements({
    providerSettingsView,
  });

  const providerId = normalizeCodingPlanProviderId(target?.providerId);
  const productsProviderId = providerId
    ? resolveCodingPlanUpgradeProductsProviderId(providerId)
    : null;
  const teamPlanFamily = productsProviderId
    ? resolveModelProviderFamilyIdByProviderId(productsProviderId)
    : null;
  const refreshProviderState = useCallback(
    () => providerSettingsService.refresh("coding-plan-purchase-complete"),
    [providerSettingsService],
  );
  const handlePurchaseComplete = useCallback(async () => {
    await closeAndRefreshCodingPlanUpgradeFromWebview({
      onClose,
      refresh: () =>
        refreshCodingPlanUpgradeCompletion({
          productsProviderId,
          providerId,
          refreshCodingPlanEntitlements,
          refreshProviderState,
          refreshTeamPlanProducts:
            teamPlanFamily !== null
              ? () =>
                  codingPlanSubscriptionService.getEnterprisePricing({
                    authenticated: true,
                    family: teamPlanFamily,
                  })
              : undefined,
        }),
      onRefreshError: (error) => {
        logger.warn("[CodingPlanUpgradeDialog] 购买完成后刷新状态失败", {
          providerId,
          productsProviderId,
          error,
        });
      },
    });
  }, [
    codingPlanSubscriptionService,
    onClose,
    productsProviderId,
    providerId,
    refreshCodingPlanEntitlements,
    refreshProviderState,
    teamPlanFamily,
  ]);

  if (!target || !providerId || !productsProviderId) {
    return null;
  }

  return (
    <CodingPlanEmbeddedWebviewDialog
      open
      onOpenResult={onOpenResult}
      credentialService={credentialService}
      providerId={providerId}
      funnelContext={target.funnelContext}
      audience={target.initialAudience}
      teamPlanKey={target.initialTeamPlanKey}
      onPurchaseComplete={handlePurchaseComplete}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    />
  );
}
