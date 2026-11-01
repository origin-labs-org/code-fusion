import { useEffect, useRef } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { toast, dismissToast } from "@/components/ui/toast.js";
import {
  createAccountConnectionRefreshObserver,
  type AccountConnectionLoss,
} from "@/root/accountConnectionRefreshObserver.js";
import { prepareAccountConnectionSwitch } from "@/root/accountConnectionLossSuggestion.js";
import { logger } from "@/logger.js";

export function useAccountConnectionLossNotification(
  services: IServiceAccessor,
  intentKey: string,
  refreshAppSettings?: () => Promise<void>,
) {
  const { intl } = useCfIntl();
  const latest = useRef({ intl, refreshAppSettings });
  latest.current = { intl, refreshAppSettings };
  const observerRef = useRef<ReturnType<typeof createAccountConnectionRefreshObserver> | null>(
    null,
  );
  const noticeRef = useRef<{ id: number; event: AccountConnectionLoss } | null>(null);
  useEffect(() => {
    observerRef.current?.invalidate();
    if (noticeRef.current) dismissToast(noticeRef.current.id);
    noticeRef.current = null;
  }, [intentKey]);
  useEffect(() => {
    const observer = createAccountConnectionRefreshObserver(async (event) => {
      let suggestion: Awaited<ReturnType<typeof prepareAccountConnectionSwitch>> = null;
      try {
        suggestion = await prepareAccountConnectionSwitch(services, event);
      } catch (error) {
        logger.lifecycle.warn("[AccountConnection] Unable to confirm replacement plan; displaying status only", { error });
      }
      if (!event.isCurrent()) return;
      const { intl: copy } = latest.current;
      const label =
        suggestion?.label ??
        (suggestion
          ? copy.formatMessage({
              id:
                suggestion.selection.kind === "start-plan"
                  ? "settings.modelProvider.codingPlan.purchaseBanner.startPlanTitle"
                  : "settings.modelProvider.codingPlan.purchase.individualsSectionTitle",
            })
          : "");
      const target = suggestion;
      let id: number;
      let submitting = false;
      const submit = () => {
        if (!target || submitting) return;
        submitting = true;
        void (async () => {
          try {
            const result = await target.apply();
            dismissToast(id);
            if (result === "stale") {
              toast(
                latest.current.intl.formatMessage({
                  id: "settings.modelProvider.connectionSuggestionStale",
                }),
                { variant: "info" },
              );
              return;
            }
            try {
              await latest.current.refreshAppSettings?.();
            } catch (error) {
              logger.lifecycle.warn("[AccountConnection] Connection saved; failed to refresh settings snapshot", { error });
            }
          } catch (error) {
            logger.lifecycle.warn("[AccountConnection] 手动切换套餐失败", { error });
            if (!event.isCurrent()) return;
            id = toast(
              latest.current.intl.formatMessage({
                id: "settings.modelProvider.connectionSwitchFailed",
              }),
              {
                variant: "warning",
                durationMs: 12000,
                actionLabel: latest.current.intl.formatMessage({ id: "common.retry" }),
                onAction: submit,
              },
            );
            noticeRef.current = { id, event };
          } finally {
            submitting = false;
          }
        })();
      };
      id = toast(copy.formatMessage({ id: "settings.modelProvider.connectionUnavailableNotice" }), {
        variant: "info",
        durationMs: 12000,
        actionLabel: target
          ? copy.formatMessage(
              { id: "settings.modelProvider.switchConnection" },
              { connection: label },
            )
          : undefined,
        onAction: target ? submit : undefined,
      });
      noticeRef.current = { id, event };
    });
    observerRef.current = observer;
    const accept = (view: Parameters<typeof observer.accept>[0]) => {
      void observer.accept(view);
      const notice = noticeRef.current;
      if (notice && !notice.event.isCurrent()) {
        dismissToast(notice.id);
        noticeRef.current = null;
      }
    };
    const subscription = services.providerSettingsService.onDidChange(accept);
    void services.providerSettingsService
      .getView()
      .then(accept)
      .catch((error) => {
        logger.lifecycle.warn("[AccountConnection] Initial read failed; awaiting normal refresh", { error });
      });
    return () => {
      observer.dispose();
      observerRef.current = null;
      subscription.dispose();
      if (noticeRef.current) dismissToast(noticeRef.current.id);
      noticeRef.current = null;
    };
  }, [services]);
}
