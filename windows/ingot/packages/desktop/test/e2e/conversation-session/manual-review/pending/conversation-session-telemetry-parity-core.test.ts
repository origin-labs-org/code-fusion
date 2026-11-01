import { clearAppData } from "../../../helpers/desktop-app.js";
import {
  E2E_READONLY_TOOL_FILE_PATH,
  clickChatStop,
  prepareConversationE2E,
  sendPrompt,
  startNewTask,
  waitForAssistantMessageContaining,
  waitForChatState,
  waitForComposerText,
  waitForUserMessageContaining,
} from "../../../helpers/conversation-session.js";
import {
  beginConversationTelemetryCapture,
  finishConversationTelemetryCapture,
  telemetryInventory,
  waitForConversationReportInventory,
  type ArmsCustomEventPayload,
  type ConversationTelemetryCaptureHandle,
} from "../../../helpers/conversation-telemetry-parity-capture.js";

const CASE_ID = "TDP-CORE";
const TOOL_MARKER = "E2E_TELEMETRY_PARITY_TOOL";
const TOOL_REPLY = "telemetry-parity-tool-ok";
const COMPACT_MARKER = "E2E_TELEMETRY_PARITY_COMPACT";
const COMPACT_REPLY = "telemetry-parity-compact-seed-ok";
const REASONING_MARKER = "E2E_TELEMETRY_PARITY_REASONING";
const REASONING_REPLY = "telemetry-parity-reasoning-ok";
const STALL_MARKER = "E2E_TELEMETRY_PARITY_STALL";
const STALL_REPLY = "telemetry-parity-stall-ok";
const INTERRUPT_MARKER = "E2E_TELEMETRY_PARITY_INTERRUPT";
const INTERRUPT_PREFIX = "telemetry-parity-interrupt-start";

type JsonRecord = Record<string, unknown>;

describe("会话埋点旧版/V4 核心运行时差分 E2E", () => {
  after(async () => {
    await browser.electron.restoreAllMocks();
    await clearAppData();
  });

  it("Realistic coverage of tools, thinking, stall, interrupted, and compact before capturing final telemetry", async function () {
    this.timeout(300000);

    await prepareConversationE2E();
    const captureHandle = await beginConversationTelemetryCapture();

    await runToolSuccessCase();
    await runCompactionSuccessCase(captureHandle);
    await runReasoningCase();
    await runStreamStallCase();
    await runInterruptedCase();

    const capture = await finishConversationTelemetryCapture(captureHandle, {
      caseId: CASE_ID,
      minimumReportInventory: {
        agent_step: 6,
        context_compaction: 1,
        message_completion: 5,
        send_btn: 5,
      },
      minimumArmsInventory: {
        perf_ui_first_token: 5,
        perf_ui_message_complete: 5,
        perf_ui_stream_stall: 1,
        perf_ui_tool_call_detail: 1,
        perf_ui_turn_breakdown: 5,
        plan_request: 10,
        plan_ttft: 5,
      },
    });

    assertRuntimeCoverage(capture.eventReport, capture.armsFinal);
    if (capture.armsRenderer) {
      expect(telemetryInventory(capture.armsFinal, "name")).toEqual(
        telemetryInventory(capture.armsRenderer, "name"),
      );
    }
  });
});

async function runToolSuccessCase(): Promise<void> {
  const prompt = `${TOOL_MARKER}: Read ${E2E_READONLY_TOOL_FILE_PATH}, then reply with exactly "${TOOL_REPLY}".`;
  await sendPrompt(prompt);
  await waitForComposerText("", "Input box was not cleared after sending tool telemetry case");
  await waitForUserMessageContaining(TOOL_MARKER);
  await waitForAssistantMessageContaining(TOOL_REPLY);
  await waitForIdle("Tool telemetry case did not complete");
}

async function runCompactionSuccessCase(
  captureHandle: ConversationTelemetryCaptureHandle,
): Promise<void> {
  await startNewTaskForParity();
  const prompt = `${COMPACT_MARKER}: Reply with exactly "${COMPACT_REPLY}" and no other text.`;
  await sendPrompt(prompt);
  await waitForAssistantMessageContaining(COMPACT_REPLY);
  await waitForIdle("compact seed did not complete");

  await sendPrompt("/compact");
  await waitForComposerText("", "Input box was not cleared after /compact");
  await waitForConversationReportInventory(captureHandle, {
    context_compaction: 1,
  });
}

async function runReasoningCase(): Promise<void> {
  await startNewTaskForParity();
  const prompt = `${REASONING_MARKER}: Reply with exactly "${REASONING_REPLY}".`;
  await sendPrompt(prompt);
  await waitForAssistantMessageContaining(REASONING_REPLY);
  await waitForIdle("thought -> text telemetry case did not complete");
}

async function runStreamStallCase(): Promise<void> {
  await startNewTaskForParity();
  const prompt = `${STALL_MARKER}: Reply with exactly "${STALL_REPLY}".`;
  await sendPrompt(prompt);
  await waitForAssistantMessageContaining(STALL_REPLY);
  await waitForIdle("3001ms stall telemetry case did not complete");
}

async function runInterruptedCase(): Promise<void> {
  await startNewTaskForParity();
  const prompt = `${INTERRUPT_MARKER}: Start the response, then keep streaming until stopped.`;
  await sendPrompt(prompt);
  await waitForAssistantMessageContaining(INTERRUPT_PREFIX);
  await waitForChatState(
    (snapshot) => snapshot.state === "streaming",
    "interrupted 埋点 case 没有进入 streaming",
    30000,
  );
  await clickChatStop();
  await waitForIdle("interrupted telemetry case did not finish after stop");
}

async function startNewTaskForParity(): Promise<void> {
  await startNewTask();
  await browser.pause(500);
}

async function waitForIdle(message: string): Promise<void> {
  await waitForChatState(
    (snapshot) => snapshot.state === "idle" && snapshot.queueCount === 0,
    message,
    90000,
  );
}

function assertRuntimeCoverage(eventReport: JsonRecord[], armsFinal: JsonRecord[]): void {
  const reportInventory = telemetryInventory(eventReport, "element_name");
  expect(reportInventory.send_btn).toBe(5);
  expect(reportInventory.message_completion).toBe(5);
  expect(reportInventory.context_compaction).toBe(1);
  expect(reportInventory.agent_step).toBeGreaterThanOrEqual(6);

  const details = eventReport
    .map((event) => event.event_extra_detail)
    .filter((detail): detail is JsonRecord => isRecord(detail));
  expect(
    details.some(
      (detail) =>
        detail.step_type === "tool_call" &&
        String(detail.tool_name).toLowerCase() === "read" &&
        detail.status === "success",
    ),
  ).toBe(true);
  expect(details.some((detail) => detail.step_type === "reasoning")).toBe(true);
  expect(
    details.some(
      (detail) => detail.status === "user_interrupt" && detail.error_type === "USER_INTERRUPT",
    ),
  ).toBe(true);
  expect(
    details.some(
      (detail) => detail.status === "completed" && detail.trigger === "manual",
    ),
  ).toBe(true);

  const armsInventory = telemetryInventory(
    armsFinal as unknown as ArmsCustomEventPayload[],
    "name",
  );
  expect(armsInventory.perf_ui_stream_stall).toBeGreaterThanOrEqual(1);
  expect(armsInventory.perf_ui_tool_call_detail).toBe(1);
  expect(armsInventory.perf_ui_first_token).toBe(5);
  expect(armsInventory.perf_ui_message_complete).toBe(5);
  expect(armsInventory.perf_ui_turn_breakdown).toBe(5);
  expect(armsInventory.plan_request).toBeGreaterThanOrEqual(10);
  expect(armsInventory.plan_ttft).toBeGreaterThanOrEqual(5);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
