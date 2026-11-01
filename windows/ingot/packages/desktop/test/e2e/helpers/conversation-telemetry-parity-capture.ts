
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const CONVERSATION_REPORT_EVENT_NAMES = [
  "send_btn",
  "agent_step",
  "message_completion",
  "context_compaction",
  "assistant_message_feedback",
] as const;

export const CONVERSATION_ARMS_EVENT_NAMES = [
  "plan_request",
  "plan_ttft",
  "perf_ui_first_token",
  "perf_ui_message_complete",
  "perf_ui_turn_breakdown",
  "perf_ui_stream_stall",
  "perf_ui_tool_call_detail",
  "chat_error_banner",
] as const;

type JsonRecord = Record<string, unknown>;
type FinalArmsCaptureMode = "bridge" | "legacy-file";

export type ConversationTelemetryReport = JsonRecord;

export interface ArmsCustomEventPayload {
  name: string;
  group: string;
  value?: number;
  properties?: Record<string, string | number | boolean | undefined>;
}

export interface ConversationTelemetryParityCapture {
  version: 1;
  caseId: string;
  eventReport: JsonRecord[];
  armsRenderer?: ArmsCustomEventPayload[];
  armsFinal: JsonRecord[];
  proof?: string[];
  captureStages: {
    eventReport: "http-final";
    armsRenderer?: "renderer-pre-ipc";
    armsFinal: "main-send-custom";
  };
}

export interface ConversationTelemetryCaptureHandle {
  telemetryFetch: Awaited<ReturnType<typeof browser.electron.mock>>;
  finalArmsCaptureMode: FinalArmsCaptureMode;
  reportOffset: number;
  rendererArmsOffset: number;
  finalArmsOffset: number;
}

export async function beginConversationTelemetryCapture(): Promise<ConversationTelemetryCaptureHandle> {
  const telemetryFetch = await browser.electron.mock("net", "fetch");
  await telemetryFetch.mockResolvedValue({ ok: true, status: 204 });
  const finalArmsCaptureMode = await prepareArmsCapture();
  return {
    telemetryFetch,
    finalArmsCaptureMode,
    reportOffset: 0,
    rendererArmsOffset: 0,
    finalArmsOffset: 0,
  };
}

export async function checkpointConversationTelemetryCase(
  handle: ConversationTelemetryCaptureHandle,
  options: {
    caseId: string;
    minimumArmsInventory: Record<string, number>;
    minimumReportInventory: Record<string, number>;
    proof: string[];
  },
): Promise<ConversationTelemetryParityCapture> {
  const eventReport = await waitForReportDelta(handle, options.minimumReportInventory);
  const armsRenderer =
    handle.finalArmsCaptureMode === "bridge"
      ? await waitForRendererArmsDelta(handle, options.minimumArmsInventory)
      : undefined;
  const expectedFinalInventory = armsRenderer
    ? inventory(armsRenderer, "name")
    : options.minimumArmsInventory;
  const armsFinal = await waitForFinalArmsDelta(handle, expectedFinalInventory);
  const artifact: ConversationTelemetryParityCapture = {
    version: 1,
    caseId: options.caseId,
    eventReport,
    ...(armsRenderer ? { armsRenderer } : {}),
    armsFinal,
    proof: options.proof,
    captureStages: {
      eventReport: "http-final",
      ...(armsRenderer ? { armsRenderer: "renderer-pre-ipc" as const } : {}),
      armsFinal: "main-send-custom",
    },
  };
  await writeParityCaseArtifact(artifact);
  return artifact;
}

export async function finishConversationTelemetryCapture(
  handle: ConversationTelemetryCaptureHandle,
  options: {
    caseId: string;
    minimumArmsInventory: Record<string, number>;
    minimumReportInventory: Record<string, number>;
  },
): Promise<ConversationTelemetryParityCapture> {
  const eventReport = await waitForTargetReportRequests(
    handle.telemetryFetch,
    options.minimumReportInventory,
  );
  const armsRenderer =
    handle.finalArmsCaptureMode === "bridge"
      ? await waitForTargetRendererArms(options.minimumArmsInventory)
      : undefined;
  const expectedFinalInventory = armsRenderer
    ? inventory(armsRenderer, "name")
    : options.minimumArmsInventory;
  const armsFinal = await waitForTargetFinalArms(
    handle.finalArmsCaptureMode,
    expectedFinalInventory,
  );
  const artifact: ConversationTelemetryParityCapture = {
    version: 1,
    caseId: options.caseId,
    eventReport,
    ...(armsRenderer ? { armsRenderer } : {}),
    armsFinal,
    captureStages: {
      eventReport: "http-final",
      ...(armsRenderer ? { armsRenderer: "renderer-pre-ipc" as const } : {}),
      armsFinal: "main-send-custom",
    },
  };
  await writeParityArtifact(artifact);
  return artifact;
}

export async function waitForConversationReportInventory(
  handle: ConversationTelemetryCaptureHandle,
  minimumInventory: Record<string, number>,
): Promise<JsonRecord[]> {
  return waitForTargetReportRequests(handle.telemetryFetch, minimumInventory);
}

export async function waitForConversationReportDelta(
  handle: ConversationTelemetryCaptureHandle,
  minimumInventory: Record<string, number>,
): Promise<ConversationTelemetryReport[]> {
  return waitForReportDelta(handle, minimumInventory);
}

export async function readConversationReportRequests(
  handle: ConversationTelemetryCaptureHandle,
): Promise<ConversationTelemetryReport[]> {
  return readTargetReportRequests(handle.telemetryFetch);
}

async function prepareArmsCapture(): Promise<FinalArmsCaptureMode> {
  const hasFinalBridge = await browser.execute(
    async (targetArmsEvents) => {
      type DebugWindow = Window & {
        __cfArmsCustomEventsE2E?: Array<ArmsCustomEventPayload & { recordedAt?: number }>;
        __cfFinalArmsCustomEventsE2E?: {
          clear(): Promise<void>;
          configure(request: { suppressedEventNames: string[] }): Promise<void>;
        };
      };
      const host = window as DebugWindow;
      host.__cfArmsCustomEventsE2E = [];
      const finalBridge = host.__cfFinalArmsCustomEventsE2E;
      if (!finalBridge) return false;
      await finalBridge.clear();
      await finalBridge.configure({ suppressedEventNames: [...targetArmsEvents] });
      return true;
    },
    [...CONVERSATION_ARMS_EVENT_NAMES],
  );
  if (hasFinalBridge) return "bridge";
  if (!process.env.CF_TELEMETRY_PARITY_LEGACY_ARMS_PATH?.trim()) {
    throw new Error("Legacy version lacks main sendCustom temporary capture path; stopped before sending");
  }
  return "legacy-file";
}

async function waitForTargetReportRequests(
  telemetryFetch: ConversationTelemetryCaptureHandle["telemetryFetch"],
  minimumInventory: Record<string, number>,
): Promise<JsonRecord[]> {
  let latest: JsonRecord[] = [];
  await browser.waitUntil(
    async () => {
      await telemetryFetch.update();
      latest = telemetryFetch.mock.calls
        .map((call) => parseTelemetryRequest(call))
        .filter((request): request is JsonRecord => request !== null)
        .filter((request) =>
          CONVERSATION_REPORT_EVENT_NAMES.includes(String(request.element_name) as never),
        );
      return inventoryContains(inventory(latest, "element_name"), minimumInventory);
    },
    {
      timeout: 30000,
      timeoutMsg: `Final /event/report 没有达到最LowEvents集合 ${JSON.stringify(minimumInventory)}`,
    },
  );
  await browser.pause(1000);
  await telemetryFetch.update();
  return telemetryFetch.mock.calls
    .map((call) => parseTelemetryRequest(call))
    .filter((request): request is JsonRecord => request !== null)
    .filter((request) =>
      CONVERSATION_REPORT_EVENT_NAMES.includes(String(request.element_name) as never),
    );
}

async function waitForTargetRendererArms(
  minimumInventory: Record<string, number>,
): Promise<ArmsCustomEventPayload[]> {
  let latest: ArmsCustomEventPayload[] = [];
  await browser.waitUntil(
    async () => {
      latest = await readTargetRendererArms();
      return inventoryContains(inventory(latest, "name"), minimumInventory);
    },
    {
      timeout: 30000,
      timeoutMsg: `renderer ARMS 没有达到最LowEvents集合 ${JSON.stringify(minimumInventory)}`,
    },
  );
  return latest;
}

async function readTargetRendererArms(): Promise<ArmsCustomEventPayload[]> {
  return browser.execute(
    (targetArmsEvents) => {
      const buffer =
        (
          window as Window & {
            __cfArmsCustomEventsE2E?: Array<ArmsCustomEventPayload & { recordedAt?: number }>;
          }
        ).__cfArmsCustomEventsE2E ?? [];
      return buffer
        .filter(
          (entry) =>
            (targetArmsEvents as readonly string[]).includes(entry.name) &&
            (entry.name !== "plan_request" || entry.properties?.ask_mode === "main_turn"),
        )
        .map(({ recordedAt: _recordedAt, ...payload }) => payload);
    },
    [...CONVERSATION_ARMS_EVENT_NAMES],
  );
}

async function waitForReportDelta(
  handle: ConversationTelemetryCaptureHandle,
  minimumInventory: Record<string, number>,
): Promise<JsonRecord[]> {
  let all: JsonRecord[] = [];
  try {
    await browser.waitUntil(
      async () => {
        all = await readTargetReportRequests(handle.telemetryFetch);
        return inventoryContains(
          inventory(all.slice(handle.reportOffset), "element_name"),
          minimumInventory,
        );
      },
      {
        timeout: 15000,
        timeoutMsg: `case /event/report 增量没有达到 ${JSON.stringify(minimumInventory)}`,
      },
    );
  } catch (error) {
    all = await readTargetReportRequests(handle.telemetryFetch);
    const actual = inventory(all.slice(handle.reportOffset), "element_name");
    throw new Error(
      `case /event/report 增量没有达到 ${JSON.stringify(minimumInventory)}，实际为 ${JSON.stringify(actual)}`,
      { cause: error },
    );
  }
  await browser.pause(300);
  all = await readTargetReportRequests(handle.telemetryFetch);
  const delta = all.slice(handle.reportOffset);
  handle.reportOffset = all.length;
  return delta;
}

async function readTargetReportRequests(
  telemetryFetch: ConversationTelemetryCaptureHandle["telemetryFetch"],
): Promise<JsonRecord[]> {
  await telemetryFetch.update();
  return telemetryFetch.mock.calls
    .map((call) => parseTelemetryRequest(call))
    .filter((request): request is JsonRecord => request !== null)
    .filter((request) =>
      CONVERSATION_REPORT_EVENT_NAMES.includes(String(request.element_name) as never),
    );
}

async function waitForRendererArmsDelta(
  handle: ConversationTelemetryCaptureHandle,
  minimumInventory: Record<string, number>,
): Promise<ArmsCustomEventPayload[]> {
  let all: ArmsCustomEventPayload[] = [];
  await browser.waitUntil(
    async () => {
      all = await readTargetRendererArms();
      return inventoryContains(
        inventory(all.slice(handle.rendererArmsOffset), "name"),
        minimumInventory,
      );
    },
    {
      timeout: 15000,
      timeoutMsg: `case renderer ARMS 增量没有达到 ${JSON.stringify(minimumInventory)}`,
    },
  );
  await browser.pause(100);
  all = await readTargetRendererArms();
  const delta = all.slice(handle.rendererArmsOffset);
  handle.rendererArmsOffset = all.length;
  return delta;
}

async function waitForFinalArmsDelta(
  handle: ConversationTelemetryCaptureHandle,
  minimumInventory: Record<string, number>,
): Promise<JsonRecord[]> {
  let all: JsonRecord[] = [];
  await browser.waitUntil(
    async () => {
      all = await readTargetFinalArms(handle.finalArmsCaptureMode);
      return inventoryContains(
        inventory(all.slice(handle.finalArmsOffset), "name"),
        minimumInventory,
      );
    },
    {
      timeout: 15000,
      timeoutMsg: `case final ARMS 增量没有达到 ${JSON.stringify(minimumInventory)}`,
    },
  );
  await browser.pause(100);
  all = await readTargetFinalArms(handle.finalArmsCaptureMode);
  const delta = all.slice(handle.finalArmsOffset);
  handle.finalArmsOffset = all.length;
  return delta;
}

async function waitForTargetFinalArms(
  mode: FinalArmsCaptureMode,
  minimumInventory: Record<string, number>,
): Promise<JsonRecord[]> {
  let latest: JsonRecord[] = [];
  await browser.waitUntil(
    async () => {
      latest = await readTargetFinalArms(mode);
      return inventoryContains(inventory(latest, "name"), minimumInventory);
    },
    {
      timeout: 15000,
      timeoutMsg: `main sendCustom final ARMS 没有达到Events集合 ${JSON.stringify(minimumInventory)}`,
    },
  );
  return latest;
}

async function readTargetFinalArms(mode: FinalArmsCaptureMode): Promise<JsonRecord[]> {
  if (mode === "legacy-file") {
    const capturePath = process.env.CF_TELEMETRY_PARITY_LEGACY_ARMS_PATH?.trim();
    if (!capturePath) return [];
    try {
      const contents = await readFile(capturePath, "utf8");
      return contents
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
        .filter(isTargetFinalArmsPayload);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  return browser.execute(
    async (targetArmsEvents) => {
      const bridge = (
        window as Window & {
          __cfFinalArmsCustomEventsE2E?: {
            read(): Promise<Array<{ payload: JsonRecord }>>;
          };
        }
      ).__cfFinalArmsCustomEventsE2E;
      if (!bridge) return [];
      const entries = await bridge.read();
      return entries
        .map((entry) => entry.payload)
        .filter(
          (payload) =>
            (targetArmsEvents as readonly string[]).includes(String(payload.name)) &&
            (payload.name !== "plan_request" ||
              (payload.properties as JsonRecord | undefined)?.ask_mode === "main_turn"),
        );
    },
    [...CONVERSATION_ARMS_EVENT_NAMES],
  );
}

function isTargetFinalArmsPayload(payload: unknown): payload is JsonRecord {
  return (
    isRecord(payload) &&
    CONVERSATION_ARMS_EVENT_NAMES.includes(String(payload.name) as never) &&
    (payload.name !== "plan_request" ||
      (payload.properties as JsonRecord | undefined)?.ask_mode === "main_turn")
  );
}

async function writeParityArtifact(artifact: ConversationTelemetryParityCapture): Promise<void> {
  const artifactPath = process.env.CF_TELEMETRY_PARITY_CAPTURE_PATH?.trim();
  if (!artifactPath) return;
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

async function writeParityCaseArtifact(
  artifact: ConversationTelemetryParityCapture,
): Promise<void> {
  const captureDir = process.env.CF_TELEMETRY_PARITY_CAPTURE_DIR?.trim();
  if (!captureDir) {
    await writeParityArtifact(artifact);
    return;
  }
  const artifactPath = resolve(captureDir, `${artifact.caseId}.capture.raw.json`);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function parseTelemetryRequest(call: unknown[]): JsonRecord | null {
  const [input, init] = call;
  if (!String(input ?? "").includes("/api/v1/event/report") || !isRecord(init)) return null;
  if (typeof init.body !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(init.body);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function telemetryInventory(
  records: Array<JsonRecord | ArmsCustomEventPayload>,
  key: "element_name" | "name",
): Record<string, number> {
  return inventory(records, key);
}

function inventory(
  records: Array<JsonRecord | ArmsCustomEventPayload>,
  key: string,
): Record<string, number> {
  return records.reduce<Record<string, number>>((counts, record) => {
    const value = String((record as JsonRecord)[key]);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function inventoryContains(actual: Record<string, number>, expected: Record<string, number>) {
  return Object.entries(expected).every(([name, count]) => (actual[name] ?? 0) >= count);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
