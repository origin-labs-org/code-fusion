import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { buildStartPlanEntitlementOptions } from "@/lib/startPlanEntitlementOptions.js";
import { useCallback } from "react";
import type { ModelSelectionView } from "@origin-ai/cf-provider";
import { isStartPlanModelProviderId, type ModelSelection } from "@origin-ai/cf-shared";
import { TID_START_PLAN_RECOMMENDATION_DIALOG } from "@origin-ai/cf-shared/test-ids";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useUsageEntitlementWithService } from "@/hooks/useUsageEntitlement.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useConfirmDialogStore } from "@/store/confirmDialogStore.js";
import { resolveStartPlanRecommendation } from "@/lib/startPlanRecommendation.js";
import { toast } from "@/components/ui/toast.js";
import { logger } from "@/logger.js";

export function useStartPlanRecommendation(
  view: ModelSelectionView | null | undefined,
  surface?: "subagent",
) {
  const services = useOptionalBaseWorkspaceServices();
  const { intl } = useCfIntl();
  const requestChoice = useConfirmDialogStore((state) => state.requestChoice);
  const start = view?.providers.find((provider) => isStartPlanModelProviderId(provider.providerId));
  const settings = useProviderSettingsView();
  const entitlement = useUsageEntitlementWithService(services?.usageStatsService, {
    ...buildStartPlanEntitlementOptions(
      settings.state.status === "ready" ? settings.state.view : null,
      start?.providerId ?? "",
    ),
    refreshOnMount: true,
    mountRefreshReason: "access",
  });
  return useCallback(
    async (selection: ModelSelection): Promise<ModelSelection | null> => {
      void entitlement.refresh({ silent: true, reason: "access" });
      const candidate = entitlement.error
        ? null
        : resolveStartPlanRecommendation(selection, view, entitlement.snapshot);
      if (!candidate || !services) return selection;
      try {
        if ((await services.settingService.get()).startPlanRecommendationDismissed)
          return selection;
      } catch (error) {
        logger.warn("[StartRecommendation] Unable to read recommendation preferences; continuing with original selection", { error });
        return selection;
      }
      let dismissed = false;
      const choice = await requestChoice({
        testId: TID_START_PLAN_RECOMMENDATION_DIALOG,
        title: intl.formatMessage({ id: "startPlan.recommendation.title" }),
        description: intl.formatMessage(
          {
            id:
              surface === "subagent"
                ? "startPlan.recommendation.subagentDescription"
                : "startPlan.recommendation.description",
          },
          { model: selection.modelId },
        ),
        confirmLabel: intl.formatMessage({ id: "startPlan.recommendation.switch" }),
        cancelLabel: intl.formatMessage({ id: "startPlan.recommendation.decline" }),
        showCloseButton: true,
        showKeyboardHints: false,
        checkbox: {
          label: intl.formatMessage({ id: "startPlan.recommendation.dismiss" }),
          onCheckedChange: (checked) => {
            dismissed = checked;
          },
        },
      });
      if (choice === "dismiss") return null;
      if (dismissed) {
        try {
          await services.settingService.update({ startPlanRecommendationDismissed: true });
        } catch (error) {
          logger.warn("[StartRecommendation] 保存推荐偏好失败", { error });
          toast(intl.formatMessage({ id: "startPlan.recommendation.preferenceSaveFailed" }));
        }
      }
      return choice === "confirm" ? candidate : selection;
    },
    [
      entitlement.error,
      entitlement.snapshot,
      entitlement.refresh,
      intl,
      requestChoice,
      services,
      surface,
      view,
    ],
  );
}
