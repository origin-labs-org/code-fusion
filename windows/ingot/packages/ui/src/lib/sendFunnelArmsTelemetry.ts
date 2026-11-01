import type { ArmsCustomEventPayload, IPlatformService } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";

export const SEND_FUNNEL_ARMS_GROUP = "send_funnel";

export const SEND_FUNNEL_EVENT_INPUT_FOCUS = "send_input_focus";
export const SEND_FUNNEL_EVENT_SEND_CLICK = "send_click";
export const SEND_FUNNEL_EVENT_SEND_RESULT = "send_result";

type ArmsReporter = Pick<IPlatformService, "reportArmsCustomEvent">;

export type SendFunnelReasonCode =
  | "attachment_not_ready"
  | "blocked"
  | "rejected"
  | "stale"
  | "failed"
  | "render_timeout"
  | "transport_error"
  | "provider_not_ready"
  | "composer_error";

let armsReporter: ArmsReporter | null = null;

export function setSendFunnelArmsReporter(reporter: ArmsReporter | null): void {
  armsReporter = reporter;
}

export function clearSendFunnelArmsReporterForTest(): void {
  armsReporter = null;
}

function emit(payload: ArmsCustomEventPayload): void {
  if (!armsReporter) {
    return;
  }
  try {
    void Promise.resolve(armsReporter.reportArmsCustomEvent(payload)).catch((error) => {
      logger.warn("[send-funnel] ARMS reporting failed", { name: payload.name, error });
    });
  } catch (error) {
    logger.warn("[send-funnel] ARMS 上报异常", { name: payload.name, error });
  }
}

export function composerScopeOf(sessionId: string | null | undefined): "session" | "draft" {
  return sessionId ? "session" : "draft";
}

function optionalId(value: string | null | undefined): string | undefined {
  return value ? value : undefined;
}

export function reportSendFunnelInputFocus(params: {
  sessionId: string | null;
  focusTime: number;
}): void {
  emit({
    name: SEND_FUNNEL_EVENT_INPUT_FOCUS,
    group: SEND_FUNNEL_ARMS_GROUP,
    value: 1,
    properties: {
      focus_time: params.focusTime,
      composer_scope: composerScopeOf(params.sessionId),
      talk_id: optionalId(params.sessionId),
    },
  });
}

export function reportSendFunnelSendClick(params: {
  sessionId: string | null;
  sendClickId: string;
  sendTime: number;
  trigger: "button" | "shortcut";
  extraDetail: Record<string, string>;
}): void {
  emit({
    name: SEND_FUNNEL_EVENT_SEND_CLICK,
    group: SEND_FUNNEL_ARMS_GROUP,
    value: 1,
    properties: {
      ...params.extraDetail,
      send_click_id: params.sendClickId,
      input_send_time: params.sendTime,
      send_trigger: params.trigger,
      composer_scope: composerScopeOf(params.sessionId),
      talk_id: optionalId(params.sessionId),
    },
  });
}

export function reportSendFunnelSendResult(params: {
  sessionId: string | null;
  commandId?: string;
  sendClickId: string;
  status: "success" | "fail";
  ackStatus?: string;
  reasonCode?: SendFunnelReasonCode;
  costMs: number;
  ackCostMs?: number;
  queueConfirmed: boolean;
  extraDetail: Record<string, string>;
}): void {
  const costMs = Math.max(0, Math.round(params.costMs));
  const ackCostMs =
    params.ackCostMs === undefined ? undefined : Math.max(0, Math.round(params.ackCostMs));
  emit({
    name: SEND_FUNNEL_EVENT_SEND_RESULT,
    group: SEND_FUNNEL_ARMS_GROUP,
    value: costMs,
    properties: {
      ...params.extraDetail,
      send_click_id: params.sendClickId,
      status: params.status,
      reason_code: params.reasonCode,
      ack_status: params.ackStatus,
      send_cost_ms: costMs,
      ack_cost_ms: ackCostMs,
      send_queue_confirmed: params.queueConfirmed,
      talk_id: optionalId(params.sessionId),
      message_id: optionalId(params.commandId),
    },
  });
}
