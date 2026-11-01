import type { CfOffPeakTask } from "@origin-ai/cf-shared";
import type { IntlInstance } from "@/i18n/IntlProvider.js";
import type { OffPeakTakeNumberAvailabilityStatus } from "@/store/offPeakTaskStore.js";

export type OffPeakCreateBlockReason = "plan" | "quota" | "unavailable";

export const OFF_PEAK_CREATE_TOOLTIP_CLASSNAME =
  "max-w-[220px] [&>span]:break-words [&>span]:whitespace-normal [&>span]:text-wrap-pretty";

export function resolveOffPeakCreateBlockReason({
  availabilityStatus,
  canTakeNumber,
  grayEnabled,
  noPlan,
}: {
  availabilityStatus: OffPeakTakeNumberAvailabilityStatus;
  canTakeNumber: boolean | undefined;
  grayEnabled: boolean;
  noPlan: boolean;
}): OffPeakCreateBlockReason | null {
  if (!grayEnabled) return null;
  if (availabilityStatus === "loading" || availabilityStatus === "error") {
    return "unavailable";
  }
  if (noPlan) return "plan";
  if (availabilityStatus !== "ready") return "unavailable";
  return canTakeNumber === true ? null : "quota";
}

export function formatOffPeakRemainingWait(
  nextTakeAt: number,
  now: number,
  intl: IntlInstance,
): string {
  const remainingMs = nextTakeAt - now;
  if (remainingMs <= 0) {
    return intl.formatMessage({
      id: "offPeak.create.remaining.lessThanMinute",
    });
  }

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return intl.formatMessage(
      { id: "offPeak.create.remaining.hoursMinutes" },
      { hours, minutes },
    );
  }
  if (hours > 0) {
    return intl.formatMessage(
      { id: "offPeak.create.remaining.hours" },
      { hours },
    );
  }
  return intl.formatMessage(
    { id: "offPeak.create.remaining.minutes" },
    { minutes },
  );
}

export type OffPeakStatusIconKind =
  | "moon"
  | "pause"
  | "spinner"
  | "success"
  | "warning"
  | "stopped";

export interface OffPeakStatusFooterPresentation {
  icon: OffPeakStatusIconKind;
  className: string;
  labelId: string;
  labelValues?: Record<string, string>;
}

export function resolveLocalizedOffPeakCreateTitle({
  currentTitle,
  hasInitialTitle,
  isEditing,
  nextDefaultTitle,
  previousDefaultTitle,
  titleTouched,
}: {
  currentTitle: string;
  hasInitialTitle: boolean;
  isEditing: boolean;
  nextDefaultTitle: string;
  previousDefaultTitle: string;
  titleTouched: boolean;
}): string {
  if (
    isEditing ||
    hasInitialTitle ||
    titleTouched ||
    currentTitle !== previousDefaultTitle
  ) {
    return currentTitle;
  }
  return nextDefaultTitle;
}

export function resolveOffPeakStatusFooter(
  task: Pick<CfOffPeakTask, "queuePosition" | "status">,
): OffPeakStatusFooterPresentation {
  switch (task.status) {
    case "queued":
      return task.queuePosition
        ? {
            icon: "moon",
            className: "text-idle-task",
            labelId: "offPeak.badge.queuePosition",
            labelValues: { position: String(task.queuePosition) },
          }
        : {
            icon: "moon",
            className: "text-idle-task",
            labelId: "offPeak.status.queued",
          };
    case "paused":
      return task.queuePosition
        ? {
            icon: "pause",
            className: "text-idle-task",
            labelId: "offPeak.badge.pausedPosition",
            labelValues: { position: String(task.queuePosition) },
          }
        : {
            icon: "pause",
            className: "text-idle-task",
            labelId: "offPeak.status.paused",
          };
    case "running":
      return {
        icon: "spinner",
        className: "text-success",
        labelId: "offPeak.status.running",
      };
    case "completed":
      return {
        icon: "success",
        className: "text-foreground-subtle",
        labelId: "offPeak.status.completed",
      };
    case "failed":
      return {
        icon: "warning",
        className: "text-destructive",
        labelId: "offPeak.status.failed",
      };
    case "cancelled":
      return {
        icon: "stopped",
        className: "text-foreground-subtle",
        labelId: "offPeak.status.cancelled",
      };
  }
}

export function shouldShowOffPeakModelSelectionIssue(
  status: Pick<CfOffPeakTask, "status">["status"],
): boolean {
  return status === "queued" || status === "paused" || status === "running";
}

export function resolveFailedOffPeakQueueFooter(
  task: Pick<CfOffPeakTask, "queuePosition" | "status">,
): OffPeakStatusFooterPresentation | null {
  if (task.status !== "failed" || task.queuePosition === undefined) return null;
  return {
    icon: "moon",
    className: "text-idle-task",
    labelId: "offPeak.badge.queuePosition",
    labelValues: { position: String(task.queuePosition) },
  };
}
