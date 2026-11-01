import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArmsCustomEventPayload, IPlatformService } from "@origin-ai/cf-shared";
import { resetMessageTelemetryForTest } from "@/lib/messageTelemetry.js";
import {
  clearSendFunnelArmsReporterForTest,
  SEND_FUNNEL_ARMS_GROUP,
  setSendFunnelArmsReporter,
} from "@/lib/sendFunnelArmsTelemetry.js";
import {
  ConversationTelemetrySupervisor,
  resolveSendAckSettlement,
} from "@/v4/telemetry/conversationTelemetrySupervisor.js";

function createPlatform() {
  const reportTelemetryEvent = vi.fn(async () => undefined);
  const reportArmsCustomEvent = vi.fn(async () => undefined);
  return {
    platform: {
      reportTelemetryEvent,
      reportArmsCustomEvent,
    } as unknown as IPlatformService,
    reportTelemetryEvent,
    reportArmsCustomEvent,
  };
}

function armsEventsNamed(
  calls: ReturnType<typeof createPlatform>["reportArmsCustomEvent"],
  name: string,
): ArmsCustomEventPayload[] {
  return calls.mock.calls
    .map(([payload]) => payload as unknown as ArmsCustomEventPayload)
    .filter((payload) => payload.name === name);
}

function reportsByElement(
  calls: ReturnType<typeof createPlatform>["reportTelemetryEvent"],
  elementName: string,
) {
  return calls.mock.calls
    .map(([payload]) => payload)
    .filter((payload) => payload.elementName === elementName);
}

const SEED_DETAIL = {
  ask_mode: "build",
  model_name: "seed-model",
  model_provider: "seed-provider",
  agent: "glm",
  plan_status: "unknown",
  plan_product_id: "",
} as const;

function createSupervisor(clock: { value: number }, options: { installReporter?: boolean } = {}) {
  const { platform, reportTelemetryEvent, reportArmsCustomEvent } = createPlatform();
  if (options.installReporter !== false) {
    setSendFunnelArmsReporter(platform);
  }
  const supervisor = new ConversationTelemetrySupervisor({
    platform,
    workspaceScopeKey: "base workspace 1",
    now: () => clock.value,
  });
  return { supervisor, reportTelemetryEvent, reportArmsCustomEvent };
}

describe("Composer SendFunnelEvent Tracking（ARMS）", () => {
  beforeEach(() => {
    resetMessageTelemetryForTest();
  });

  afterEach(() => {
    clearSendFunnelArmsReporterForTest();
  });

  describe("send_input_focus", () => {
    it("User真实聚焦上报One条，带 focus_time 与Session scope", async () => {
      const clock = { value: 1_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_input_focus");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "send_input_focus",
        group: SEND_FUNNEL_ARMS_GROUP,
        value: 1,
        properties: {
          focus_time: 1_000,
          composer_scope: "session",
          talk_id: "session-1",
        },
      });
    });

    it("Draft态不下发 talk_id 且 scope 记为 draft", async () => {
      const clock = { value: 1_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.recordComposerFocusClick({ sessionId: null });
      await supervisor.flushReportsForTest();

      const properties = armsEventsNamed(reportArmsCustomEvent, "send_input_focus")[0].properties;
      expect(properties?.composer_scope).toBe("draft");
      expect(properties?.talk_id).toBeUndefined();
    });

    it("每次真实聚焦各记One条，不做时间窗去重", async () => {
      const clock = { value: 1_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      clock.value = 1_050;
      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_input_focus");
      expect(events.map((event) => event.properties?.focus_time)).toEqual([1_000, 1_050]);
    });

    it("recordComposerFocus 仍然不产生任何上报", async () => {
      const clock = { value: 1_000 };
      const { supervisor, reportTelemetryEvent, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.recordComposerFocus();
      supervisor.recordComposerTextChange("hi");
      await supervisor.flushReportsForTest();

      expect(reportTelemetryEvent).not.toHaveBeenCalled();
      expect(reportArmsCustomEvent).not.toHaveBeenCalled();
    });
  });

  describe("send_click", () => {
    it("点击Send上报One条并回填 sendClickId", async () => {
      const clock = { value: 2_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 2_000, extraDetail: { ...SEED_DETAIL } },
      });
      await supervisor.flushReportsForTest();

      expect(seed.sendClickId).toBeTruthy();
      const events = armsEventsNamed(reportArmsCustomEvent, "send_click");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "send_click",
        group: SEND_FUNNEL_ARMS_GROUP,
        value: 1,
        properties: {
          ...SEED_DETAIL,
          send_click_id: seed.sendClickId,
          input_send_time: 2_000,
          send_trigger: "button",
          composer_scope: "session",
          talk_id: "session-1",
        },
      });
    });

    it("Enter Submit记为 shortcut", async () => {
      const clock = { value: 2_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "shortcut",
        seed: { sendTime: 2_000, extraDetail: { ...SEED_DETAIL } },
      });
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_click")[0].properties?.send_trigger).toBe(
        "shortcut",
      );
    });

    it("每次点击的 sendClickId 互不E同", () => {
      const clock = { value: 2_000 };
      const { supervisor } = createSupervisor(clock);

      const first = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 2_000, extraDetail: {} },
      });
      const second = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 2_100, extraDetail: {} },
      });

      expect(first.sendClickId).not.toBe(second.sendClickId);
    });
  });

  describe("send_result", () => {
    it("落定成功时 value 即 send_cost_ms", async () => {
      const clock = { value: 3_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 3_000, extraDetail: { ...SEED_DETAIL } },
      });

      clock.value = 3_180;
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        name: "send_result",
        group: SEND_FUNNEL_ARMS_GROUP,
        value: 180,
        properties: {
          ...SEED_DETAIL,
          send_click_id: seed.sendClickId,
          status: "success",
          ack_status: "accepted",
          send_cost_ms: 180,
          send_queue_confirmed: false,
          talk_id: "session-1",
          message_id: "command-1",
        },
      });
      expect(events[0].properties?.reason_code).toBeUndefined();
    });

    it("send_click_id 与 send_click 严格配对", async () => {
      const clock = { value: 3_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 3_000, extraDetail: {} },
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      const click = armsEventsNamed(reportArmsCustomEvent, "send_click")[0];
      const result = armsEventsNamed(reportArmsCustomEvent, "send_result")[0];
      expect(result.properties?.send_click_id).toBe(click.properties?.send_click_id);
    });

    it("落定时RetainRaw ack_status", async () => {
      const clock = { value: 3_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 3_000, extraDetail: {} },
      });

      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        status: "success",
        ackStatus: "duplicate",
      });
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")[0].properties).toMatchObject({
        status: "success",
        ack_status: "duplicate",
      });
    });

    it.each([
      ["attachment_not_ready", undefined],
      ["blocked", undefined],
      ["rejected", "rejected"],
      ["stale", "stale"],
      ["failed", "failed"],
      ["render_timeout", "accepted"],
      ["transport_error", undefined],
      ["provider_not_ready", undefined],
      ["composer_error", undefined],
    ])("Failed原因 %s 如实上报", async (reasonCode, ackStatus) => {
      const clock = { value: 4_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 4_000, extraDetail: {} },
      });

      clock.value = 4_050;
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        status: "fail",
        reasonCode,
        ...(ackStatus ? { ackStatus } : {}),
      });
      await supervisor.flushReportsForTest();

      const event = armsEventsNamed(reportArmsCustomEvent, "send_result")[0];
      expect(event.value).toBe(50);
      expect(event.properties).toMatchObject({
        status: "fail",
        reason_code: reasonCode,
        send_cost_ms: 50,
      });
      expect(event.properties?.ack_status).toBe(ackStatus);
    });

    it("未进入 dispatch 的Failed不下发 message_id", async () => {
      const clock = { value: 4_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: null,
        trigger: "button",
        seed: { sendTime: 4_000, extraDetail: {} },
      });

      supervisor.settleSendResult({ seed, sessionId: null, status: "fail", reasonCode: "blocked" });
      await supervisor.flushReportsForTest();

      const properties = armsEventsNamed(reportArmsCustomEvent, "send_result")[0].properties;
      expect(properties?.talk_id).toBeUndefined();
      expect(properties?.message_id).toBeUndefined();
    });

    it("同One sendClickId 只落定One次（first-wins）", async () => {
      const clock = { value: 5_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 5_000, extraDetail: {} },
      });

      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        status: "success",
        ackStatus: "accepted",
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        status: "fail",
        reasonCode: "rejected",
      });
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0].properties?.status).toBe("success");
    });

    it("经过QueueTwo次确认时Label记 send_queue_confirmed 并从首次点击计时", async () => {
      const clock = { value: 6_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 6_000, extraDetail: {} },
      });

      clock.value = 8_000;
      supervisor.settleSendResult({
        seed: { ...seed, queueConfirmed: true },
        sessionId: "session-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      const event = armsEventsNamed(reportArmsCustomEvent, "send_result")[0];
      expect(event.value).toBe(2_000);
      expect(event.properties).toMatchObject({ send_queue_confirmed: true, send_cost_ms: 2_000 });
    });

    it("Missing sendClickId 的 seed（BackgroundTask）不落定", async () => {
      const clock = { value: 7_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.settleSendResult({
        seed: { sendTime: 7_000, extraDetail: {} },
        sessionId: "session-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
    });
  });

  describe("待渲染Waiting（send_result 端到端口径）", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    
    function ackedSend(
      clock: { value: number },
      options: { ackStatus?: string; sendTime?: number; ackAt?: number } = {},
    ) {
      const sendTime = options.sendTime ?? 10_000;
      clock.value = sendTime;
      const handles = createSupervisor(clock);
      const seed = handles.supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime, extraDetail: { ...SEED_DETAIL } },
      });
      clock.value = options.ackAt ?? sendTime + 120;
      handles.supervisor.awaitSendRender({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        ackStatus: options.ackStatus ?? "accepted",
      });
      return { ...handles, seed, sendTime };
    }

    it("ACK accepted 后不立即上报 send_result", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock);
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_click")).toHaveLength(1);
      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
    });

    it("User Message渲染后才落定，value 为端到端耗时并单独留 ack_cost_ms", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock, {
        sendTime: 10_000,
        ackAt: 10_120,
      });

      clock.value = 10_450;
      supervisor.notifyUserInputRendered("command-1");
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        value: 450,
        properties: {
          ...SEED_DETAIL,
          status: "success",
          ack_status: "accepted",
          send_cost_ms: 450,
          ack_cost_ms: 120,
          talk_id: "session-1",
          message_id: "command-1",
        },
      });
      expect(events[0].properties?.reason_code).toBeUndefined();
    });

    it("duplicate ACK 与 accepted 走同One条Waiting路径", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock, { ackStatus: "duplicate" });
      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);

      clock.value = 10_300;
      supervisor.notifyUserInputRendered("command-1");
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")[0].properties).toMatchObject({
        status: "success",
        ack_status: "duplicate",
      });
    });

    it("30s inner没等到渲染则报 render_timeout，send_cost_ms 取 30000", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock, {
        sendTime: 10_000,
        ackAt: 10_120,
      });

      clock.value = 40_000;
      await vi.advanceTimersByTimeAsync(30_000);
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        value: 30_000,
        properties: {
          status: "fail",
          reason_code: "render_timeout",
          ack_status: "accepted",
          send_cost_ms: 30_000,
          ack_cost_ms: 120,
        },
      });
    });

    it("渲染先到则超时定时器不再补报（first-wins）", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock);

      clock.value = 10_500;
      supervisor.notifyUserInputRendered("command-1");
      await vi.advanceTimersByTimeAsync(60_000);
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0].properties?.status).toBe("success");
    });

    it("超时先到则迟到的渲染LetterNumber不再上报（first-wins）", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock);

      clock.value = 40_000;
      await vi.advanceTimersByTimeAsync(30_000);
      clock.value = 41_000;
      supervisor.notifyUserInputRendered("command-1");
      await supervisor.flushReportsForTest();

      const events = armsEventsNamed(reportArmsCustomEvent, "send_result");
      expect(events).toHaveLength(1);
      expect(events[0].properties?.reason_code).toBe("render_timeout");
    });

    it("未登记的 commandId 渲染LetterNumber不触发上报", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock);

      clock.value = 10_500;
      supervisor.notifyUserInputRendered("command-from-history");
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
    });

    it("BackgroundTask seed（无 sendClickId）不登记待渲染", async () => {
      const clock = { value: 10_000 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.awaitSendRender({
        seed: { sendTime: 10_000, extraDetail: {} },
        sessionId: "session-1",
        commandId: "command-bg",
        ackStatus: "accepted",
      });
      clock.value = 10_300;
      supervisor.notifyUserInputRendered("command-bg");
      await vi.advanceTimersByTimeAsync(60_000);
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
    });

    it("dispose 后超时定时器不再上报", async () => {
      const clock = { value: 0 };
      const { supervisor, reportArmsCustomEvent } = ackedSend(clock);

      supervisor.dispose();
      clock.value = 40_000;
      await vi.advanceTimersByTimeAsync(60_000);
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
    });
  });

  describe("resolveSendAckSettlement（ACK → 落定口径）", () => {
    it("accepted 与 duplicate 转入待渲染Waiting", () => {
      expect(resolveSendAckSettlement({ status: "accepted" })).toEqual({
        kind: "awaitRender",
        ackStatus: "accepted",
      });
      expect(resolveSendAckSettlement({ status: "duplicate" })).toEqual({
        kind: "awaitRender",
        ackStatus: "duplicate",
      });
    });

    it.each([
      ["rejected", "rejected"],
      ["stale", "stale"],
      ["failed", "failed"],
    ])("%s 立即落定并原样落到 reason_code", (ackStatus, reasonCode) => {
      expect(resolveSendAckSettlement({ status: ackStatus })).toEqual({
        kind: "settle",
        status: "fail",
        ackStatus,
        reasonCode,
      });
    });

    it("noop 归口到 failed 但RetainRaw ack_status", () => {
      expect(resolveSendAckSettlement({ status: "noop" })).toEqual({
        kind: "settle",
        status: "fail",
        ackStatus: "noop",
        reasonCode: "failed",
      });
    });

    it("QueueTwo次确认的 ACK 既不落定也不Waiting渲染", () => {
      expect(
        resolveSendAckSettlement({
          status: "rejected",
          reasonCode: "guard.heldQueueConfirmationStale",
        }),
      ).toBeNull();
    });

    it("其余 reasonCode 不影响落定", () => {
      expect(
        resolveSendAckSettlement({ status: "rejected", reasonCode: "guard.somethingElse" }),
      ).toEqual({ kind: "settle", status: "fail", ackStatus: "rejected", reasonCode: "rejected" });
    });
  });

  describe("与 /event/report 通道的Isolated", () => {
    it("Three个FunnelEvents完全不走 reportTelemetryEvent", async () => {
      const clock = { value: 100 };
      const { supervisor, reportTelemetryEvent } = createSupervisor(clock);

      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 100, extraDetail: { ...SEED_DETAIL } },
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      expect(reportTelemetryEvent).not.toHaveBeenCalled();
    });

    it("NewEvents不改变 send_btn 的时机与Character段", async () => {
      const clock = { value: 100 };
      const { supervisor, reportTelemetryEvent } = createSupervisor(clock);

      supervisor.recordComposerFocusClick({ sessionId: null });
      supervisor.recordComposerFocus();
      clock.value = 120;
      supervisor.recordComposerTextChange("hello");
      clock.value = 200;
      const seed = supervisor.recordSendClick({
        sessionId: null,
        trigger: "button",
        seed: { sendTime: 200, extraDetail: { ...SEED_DETAIL } },
      });
      clock.value = 260;
      supervisor.acceptPromptSeed({
        ...seed,
        sessionId: "session-1",
        sourceCommandId: "command-1",
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        commandId: "command-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      const send = reportsByElement(reportTelemetryEvent, "send_btn");
      expect(send).toHaveLength(1);
      expect(send[0]).toMatchObject({
        eventRegion: "app",
        eventType: "ck",
        talkId: "session-1",
        messageId: "command-1",
        eventExtraDetail: {
          ...SEED_DETAIL,
          input_start_time: "100",
          input_first_char_time: "120",
          input_send_time: "200",
        },
      });
      expect(send[0].eventExtraDetail).not.toHaveProperty("send_click_id");
      expect(send[0].eventExtraDetail).not.toHaveProperty("send_cost_ms");
    });

    it("BackgroundAutoTask不产生任何FunnelEvents", async () => {
      const clock = { value: 100 };
      const { supervisor, reportTelemetryEvent, reportArmsCustomEvent } = createSupervisor(clock);

      supervisor.acceptPromptSeed(
        {
          sessionId: "session-1",
          sourceCommandId: "background-command",
          sendTime: 100,
          extraDetail: { message_source: "scheduled_task" },
        },
        { reportSendButton: false },
      );
      await supervisor.flushReportsForTest();

      expect(armsEventsNamed(reportArmsCustomEvent, "send_input_focus")).toHaveLength(0);
      expect(armsEventsNamed(reportArmsCustomEvent, "send_click")).toHaveLength(0);
      expect(armsEventsNamed(reportArmsCustomEvent, "send_result")).toHaveLength(0);
      expect(reportsByElement(reportTelemetryEvent, "send_btn")).toHaveLength(0);
    });
  });

  describe("reporter 未Install时静默", () => {
    it("未Install reporter 时不调用 platform", async () => {
      const clock = { value: 100 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock, {
        installReporter: false,
      });

      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 100, extraDetail: {} },
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      expect(reportArmsCustomEvent).not.toHaveBeenCalled();
    });
  });

  describe("dispose 后静默", () => {
    it("dispose 后Three个Events都不再上报", async () => {
      const clock = { value: 100 };
      const { supervisor, reportArmsCustomEvent } = createSupervisor(clock);
      const seed = supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 100, extraDetail: {} },
      });
      await supervisor.flushReportsForTest();
      reportArmsCustomEvent.mockClear();

      supervisor.dispose();
      supervisor.recordComposerFocusClick({ sessionId: "session-1" });
      supervisor.recordSendClick({
        sessionId: "session-1",
        trigger: "button",
        seed: { sendTime: 200, extraDetail: {} },
      });
      supervisor.settleSendResult({
        seed,
        sessionId: "session-1",
        status: "success",
        ackStatus: "accepted",
      });
      await supervisor.flushReportsForTest();

      expect(reportArmsCustomEvent).not.toHaveBeenCalled();
    });
  });
});
