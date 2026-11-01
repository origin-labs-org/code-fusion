import { useEffect, useState, type ComponentType, type SVGProps } from "react";
import {
  DYNAMIC_WORKFLOW_MODES,
  normalizeDynamicWorkflowMode,
  readDynamicWorkflowOfferedMode,
  TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM,
  TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER,
  type AppSettings,
  type DynamicWorkflowMode,
} from "@origin-ai/cf-shared";
import { testId } from "@origin-ai/cf-shared/test-ids";
import {
  DynamicWorkflowAlwaysOnIcon,
  DynamicWorkflowOffIcon,
  DynamicWorkflowOnCommandIcon,
} from "@/components/icons/dynamicWorkflowModeIcons.js";
import {
  Select,
  SelectContent,
  SelectRichItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { toast } from "@/components/ui/toast.js";
import { useDynamicWorkflowAvailability } from "@/hooks/useDynamicWorkflowAvailability.js";
import { useSettings } from "@/hooks/useSettingService.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { SettingsRow } from "@/settings/SettingsPageParts.js";
import type { DynamicWorkflowAvailabilitySnapshot } from "@/store/dynamicWorkflowAvailabilityStore.js";

const MODE_ICONS: Record<DynamicWorkflowMode, ComponentType<SVGProps<SVGSVGElement>>> = {
  disabled: DynamicWorkflowOffIcon,
  onDemand: DynamicWorkflowOnCommandIcon,
  alwaysOn: DynamicWorkflowAlwaysOnIcon,
};

export function resolveDynamicWorkflowModeSettingView(
  snapshot: DynamicWorkflowAvailabilitySnapshot,
): { value: DynamicWorkflowMode; offeredMode: DynamicWorkflowMode } | null {
  const config = snapshot.config;
  if (snapshot.status !== "ready" || !config) return null;
  const offeredMode = readDynamicWorkflowOfferedMode(config);
  return offeredMode ? { value: config.mode, offeredMode } : null;
}

export function buildDynamicWorkflowModePatch(
  next: DynamicWorkflowMode,
  offeredMode: DynamicWorkflowMode,
): Pick<AppSettings, "dynamicWorkflowMode"> {
  return {
    dynamicWorkflowMode: (next === offeredMode ? "" : next) as AppSettings["dynamicWorkflowMode"],
  };
}

export function DynamicWorkflowModeSetting() {
  const { intl } = useCfIntl();
  const { update } = useSettings();
  const view = resolveDynamicWorkflowModeSettingView(useDynamicWorkflowAvailability());
  const [pending, setPending] = useState<DynamicWorkflowMode | null>(null);
  const settledValue = view?.value;
  useEffect(() => {
    if (pending !== null && settledValue === pending) setPending(null);
  }, [pending, settledValue]);

  if (!view) return null;
  const value = pending ?? view.value;
  const label = intl.formatMessage({ id: "settings.dynamicWorkflow" });

  const handleValueChange = async (rawValue: string) => {
    const next = normalizeDynamicWorkflowMode(rawValue);
    if (!next || next === value) return;
    setPending(next);
    try {
      await update(buildDynamicWorkflowModePatch(next, view.offeredMode));
    } catch (error) {
      setPending(null);
      logger.warn("[settings] 保存动态工作流模式失败", { error: String(error) });
      toast(intl.formatMessage({ id: "settings.dynamicWorkflow.saveError" }));
    }
  };

  return (
    <SettingsRow
      label={label}
      description={intl.formatMessage({ id: "settings.dynamicWorkflowDescription" })}
      controlLayout="wide"
      control={
        <Select value={value} onValueChange={(next) => void handleValueChange(next)}>
          <SelectTrigger
            size="lg"
            className="w-[260px] min-w-0 justify-between"
            aria-label={label}
            data-testid={TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_TRIGGER}
          >
            <SelectValue />
          </SelectTrigger>
          {}
          <SelectContent
            position="popper"
            align="end"
            sideOffset={4}
            className="w-(--radix-select-trigger-width)"
          >
            {DYNAMIC_WORKFLOW_MODES.map((mode) => {
              const Icon = MODE_ICONS[mode];
              return (
                <SelectRichItem
                  key={mode}
                  value={mode}
                  data-testid={testId(TID_SETTINGS_DYNAMIC_WORKFLOW_MODE_ITEM, mode)}
                  icon={<Icon className="size-4.5" />}
                  title={intl.formatMessage({ id: `settings.dynamicWorkflow.option.${mode}` })}
                  titleAdornment={
                    mode === view.offeredMode ? (
                      <span className="inline-flex h-4 shrink-0 items-center rounded-sm bg-tag px-1 text-ui-xs font-medium text-foreground-subtle">
                        {intl.formatMessage({ id: "settings.dynamicWorkflow.defaultTag" })}
                      </span>
                    ) : null
                  }
                  description={intl.formatMessage({
                    id: `settings.dynamicWorkflow.option.${mode}.description`,
                  })}
                />
              );
            })}
          </SelectContent>
        </Select>
      }
    />
  );
}
