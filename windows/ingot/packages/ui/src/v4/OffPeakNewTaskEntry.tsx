import { useCodingPlanEntryGate } from "@/settings/CodingPlanEntryButton.js";

import { BUILTIN_MODEL_PROVIDER_IDS } from "@origin-ai/cf-shared";
import { Megaphone, Moon, X } from "lucide-react";
import { ClientSceneLucideIcon } from "@/components/ClientSceneLucideIcon.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { toast } from "@/components/ui/toast.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useProviderSettingsView } from "@/hooks/useProviderSettingsView.js";
import { useOffPeakEligibility } from "@/hooks/useOffPeakEligibility.js";
import { useServices } from "@/hooks/useServices.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { logger } from "@/logger.js";
import {
  createIdleTimeCodingPlanFunnelContext,
  resolveCodingPlanEntryPlanStateFromProviderSettings,
} from "@/lib/codingPlanFunnelTelemetry.js";
import {
  appendLocalCustomizeTemplate,
  materializeOffPeakTemplateDraft,
  resolveOffPeakTemplateText,
  type OffPeakAutomationTemplate,
} from "@/settings/automationTemplateCatalog.js";
import { useAutomationTemplates } from "@/settings/useAutomationTemplates.js";
import { useOptionalCodingPlanUpgradeDialog } from "@/settings/CodingPlanUpgradeDialogProvider.js";
import { useOffPeakTaskStore, type OffPeakCreateDraft } from "@/store/offPeakTaskStore.js";
import { useMemo } from "react";

interface OffPeakNewTaskEntryProps {
  
  onOpenAutomations?: () => void;
}

export function OffPeakNewTaskEntry({ onOpenAutomations }: OffPeakNewTaskEntryProps) {
  const { intl, locale } = useCfIntl();
  const { clientScenesService } = useServices();
  const { offPeak: remoteOffPeakTemplates } = useAutomationTemplates(clientScenesService);
  const offPeakTemplates = useMemo(
    () => appendLocalCustomizeTemplate(remoteOffPeakTemplates),
    [remoteOffPeakTemplates],
  );
  const { settings: sharedSettings } = useSettings();
  const providerSettingsRead = useProviderSettingsView();
  const providerSettingsView =
    providerSettingsRead.state.status === "ready" ? providerSettingsRead.state.view : null;
  useOffPeakEligibility(sharedSettings, providerSettingsView?.revision);
  const codingPlanUpgradeDialog = useOptionalCodingPlanUpgradeDialog();
  const entryGate = useCodingPlanEntryGate();
  const grayConfig = useOffPeakTaskStore((state) => state.grayConfig);
  const dismissed = useOffPeakTaskStore((state) => state.newTaskBannerDismissed);
  const dismiss = useOffPeakTaskStore((state) => state.dismissNewTaskBanner);
  const setPendingCreateDraft = useOffPeakTaskStore((state) => state.setPendingCreateDraft);

  if (grayConfig?.enabled !== true || dismissed) return null;

  const entryPlanState = resolveCodingPlanEntryPlanStateFromProviderSettings(providerSettingsView);
  const codingPlanUnavailable =
    grayConfig.codingPlanActive === false ||
    (grayConfig.codingPlanActive === undefined &&
      providerSettingsView !== null &&
      entryPlanState.entryPlanStatus !== "coding_plan");

  const showCodingPlanRequiredToast = () => {
    toast(entryGate.label ?? intl.formatMessage({ id: "offPeak.create.codingPlanToast" }), {
      durationMs: 8000,
      position: "top-center",
      variant: "info",
      actionLabel:
        entryGate.status === "loading"
          ? undefined
          : (entryGate.label ??
            intl.formatMessage({
              id: "settings.modelProvider.codingPlan.upgrade",
            })),
      onAction:
        entryGate.status === "error"
          ? entryGate.retry
          : () => {
              const providerId =
                sharedSettings?.providerFamilyDomain === "bigmodel"
                  ? BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan
                  : BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan;
              const eventText = intl.formatMessage({
                id: "settings.modelProvider.codingPlan.upgrade",
              });
              codingPlanUpgradeDialog?.openCodingPlanUpgrade({
                providerId,
                initialAudience: "personal",
                funnelContext: createIdleTimeCodingPlanFunnelContext({
                  providerId,
                  eventText,
                  entryPlanState,
                }),
              });
            },
      dismissible: true,
      dismissLabel: intl.formatMessage({ id: "common.close" }),
    });
  };

  const handleCardClick = (template: OffPeakAutomationTemplate) => {
    if (codingPlanUnavailable) {
      logger.debug("[off-peak] blocked home template without any Coding Plan", {
        templateId: template.id,
      });
      showCodingPlanRequiredToast();
      return;
    }
    const materialized = materializeOffPeakTemplateDraft(template, locale);
    const draft: OffPeakCreateDraft = {
      ...(template.customize ? {} : { title: materialized.title, prompt: materialized.prompt }),
      telemetrySource: {
        eventRegion: "app.session",
        templateId: template.id,
      },
    };
    setPendingCreateDraft(draft);
    onOpenAutomations?.();
  };

  return (
    <div
      data-off-peak-new-task-entry="true"
      className="flex w-full shrink-0 flex-col items-center gap-3 px-4 pb-[38px]"
    >
      {}
      <div
        data-off-peak-new-task-banner="true"
        className="flex w-full max-w-[580px] items-center justify-center"
      >
        <div className="flex min-w-0 items-center gap-1 text-foreground-subtle opacity-80">
          <span className="flex size-8 shrink-0 items-center justify-center" aria-hidden="true">
            <Megaphone className="size-4" strokeWidth={2} />
          </span>
          {}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                {}
                <span
                  tabIndex={0}
                  className="min-w-0 cursor-default rounded-sm text-ui-caption font-normal leading-snug focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-hover"
                >
                  {intl.formatMessage({ id: "offPeak.newTask.bannerText" })}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6} className="max-w-none whitespace-nowrap">
                <span>
                  {intl.formatMessage({
                    id: "offPeak.newTask.bannerTipText",
                  })}
                </span>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {}
        <button
          type="button"
          data-off-peak-new-task-dismiss="true"
          onClick={dismiss}
          aria-label={intl.formatMessage({ id: "common.close" })}
          className="ml-auto hidden size-8 shrink-0 items-center justify-center rounded-md text-foreground-subtle opacity-80 hover:bg-hover hover:opacity-100"
        >
          <X className="size-4" strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {}
      <div
        data-off-peak-template-grid="true"
        className="grid w-full max-w-[780px] grid-cols-1 gap-4 sm:grid-cols-3"
      >
        {offPeakTemplates.map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => handleCardClick(template)}
            className="flex h-full w-full flex-col gap-2 rounded-2xl border border-card-border bg-background p-3 text-left transition-colors hover:bg-surface-hover"
          >
            <div className="flex items-center gap-1.5 text-foreground">
              <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
                <ClientSceneLucideIcon
                  name={template.iconName}
                  aria-hidden="true"
                  className="size-4"
                  size={16}
                  strokeWidth={2}
                  fallback={
                    <Moon
                      aria-hidden="true"
                      className="size-4"
                      data-off-peak-homepage-template-icon="moon"
                      size={16}
                      strokeWidth={2}
                    />
                  }
                />
              </span>
              <span className="truncate text-ui-base leading-5 text-foreground">
                {resolveOffPeakTemplateText(template, "title", locale, intl.formatMessage)}
              </span>
            </div>
            <p className="text-wrap-phrase line-clamp-2 text-ui-caption font-normal leading-snug text-foreground-subtle">
              {resolveOffPeakTemplateText(
                template,
                "homepageDescription",
                locale,
                intl.formatMessage,
              )}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
