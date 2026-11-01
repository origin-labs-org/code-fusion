// ============================================================
// ============================================================

import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect } from "vitest";
import { createInMemorySessionEventStore } from "@origin-ai/cf-adapters/storage";
import {
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  type DynamicWorkflowRunProgressPayload,
  type DynamicWorkflowRunSnapshot,
  type ModelNetworkStatusEvent,
  type ModelStatusSink,
  type SessionEvent,
} from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import {
  InMemoryJournalStore,
  type JournalStorePort,
  type NodeRecord,
  type RunEvent,
  type RunSettlement,
  type RunStopReason,
} from "@origin-ai/cf-dynamic-workflow";
import {
  createDynamicWorkflowRunService,
  type DynamicWorkflowRunService,
} from "../../src/app/dynamic-workflow-run-service.js";
import { workflowActorToolPolicy } from "../../src/app/workflow-actor-tools.js";
import {
  createWorkflowConcurrencyGovernor,
  type WorkflowConcurrencyGovernor,
} from "../../src/app/workflow-concurrency-governor.js";
import { WORKFLOW_CONCURRENCY_AUTO_GROWTH_FACTOR } from "../../src/app/workflow-default-concurrency.js";
import type { AgentRuntimeWorkflowDriverDeps } from "../../src/app/workflow-driver-types.js";
import {
  fakeFileSystemPort,
  runDriverScript,
  unsupportedExecutionPort,
} from "../workflow-driver.helpers.js";
import type { FakeProviderServer, WireFormat } from "./fake-provider-server.js";
import { FAULT_MATRIX_SHAPES, type ScriptShape, type ShapeSpec } from "./fault-matrix-scripts.js";
import {
  FAULT_CONCURRENCY_KEY,
  FAULT_MODEL_SELECTION,
  createFaultModelFactory,
} from "./fault-provider-model.js";
import { createTestAgentRuntime } from "./test-agent-runtime.js";

export const FAULT_CELL_DEFAULT_CONCURRENCY = 8;

export const FAULT_CELL_TURNS = 3;

const FAULT_CELL_CLOCK_SCALE = 0.01;

export const FAULT_CELL_STALL_AFTER_MS = 400;

const FAULT_CELL_TIMEOUT_MS = 20_000;

const STOP_WIRE_GRACE_MS = 10;

interface FaultCellOptions {
  server: FakeProviderServer;
  shape: ScriptShape;
  apiFormat: WireFormat;
  
  defaultConcurrency?: number;
  
  stallAfterMs?: number;
  
  clockScale?: number;
  timeoutMs?: number;
  
  turns?: number;
}

export interface FaultCellObservation {
  runId: string;
  settlement: RunSettlement;
  events: RunEvent[];
  statusEvents: ModelNetworkStatusEvent[];
  
  sessionEvents: SessionEvent[];
  governor: WorkflowConcurrencyGovernor;
  key: string;
  journal: InMemoryJournalStore;
  
  settledAt: number;
  shape: ShapeSpec;
  
  logicalRequests: number;
}

function makeScaledClock(input: {
  scale: number;
  
  stallAfterMs: number;
}): NonNullable<AgentRuntimeWorkflowDriverDeps["clock"]> {
  const { scale } = input;
  return {
    now: () => Date.now() / scale,
    schedule: (callback, delayMs) => {
      const timer = setTimeout(callback, Math.max(1, Math.round(delayMs * scale)));
      return () => clearTimeout(timer);
    },
    random: () => 0.5,
    stallAfterMs: input.stallAfterMs,
  };
}

export function statusCount(events: readonly ModelNetworkStatusEvent[], type: string): number {
  return events.filter((event) => event.type === type).length;
}

export function eventsOfType<T extends RunEvent["type"]>(
  events: readonly RunEvent[],
  type: T,
): Extract<RunEvent, { type: T }>[] {
  return events.filter((event): event is Extract<RunEvent, { type: T }> => event.type === type);
}

interface CellWiring {
  statusEvents: ModelNetworkStatusEvent[];
  sessionEvents: SessionEvent[];
  governor: WorkflowConcurrencyGovernor;
  clock: NonNullable<AgentRuntimeWorkflowDriverDeps["clock"]>;
  model: ReturnType<typeof createFaultModelFactory>;
  fileSystemPort: ReturnType<typeof fakeFileSystemPort>;
  scale: number;
}

function wireCell(options: Omit<FaultCellOptions, "shape">): CellWiring {
  const statusEvents: ModelNetworkStatusEvent[] = [];
  const sessionEvents: SessionEvent[] = [];
  const statusSink: ModelStatusSink = {
    publish: (event) => {
      statusEvents.push(event);
    },
  };
  const scale = options.clockScale ?? FAULT_CELL_CLOCK_SCALE;
  return {
    statusEvents,
    sessionEvents,
    governor: createWorkflowConcurrencyGovernor({
      defaultConcurrency: options.defaultConcurrency ?? FAULT_CELL_DEFAULT_CONCURRENCY,
    }),
    clock: makeScaledClock({
      scale,
      stallAfterMs: (options.stallAfterMs ?? FAULT_CELL_STALL_AFTER_MS) / scale,
    }),
    model: createFaultModelFactory({
      apiFormat: options.apiFormat,
      baseURL: options.server.baseURL,
      statusSink,
    }),
    fileSystemPort: fakeFileSystemPort({}),
    scale,
  };
}

function makeActorRuntime(
  wiring: CellWiring,
  input: {
    sessionId: Parameters<typeof createTestAgentRuntime>[0];
    persona: { system?: string; tools?: "default" | "readonly" | "none" };
    submitPort: unknown;
    escalatePort: unknown;
    modelRequestAdmission?: unknown;
  },
): AgentRuntime {
  return createTestAgentRuntime(
    input.sessionId,
    {
      systemPrompt: input.persona.system ?? "You are a workflow actor.",
      mode: "yolo",
      taskType: "workflow_child",
      subagents: { enabled: false },
      modelSelection: FAULT_MODEL_SELECTION,
      modelStreaming: "on",
      ...workflowActorToolPolicy(input.persona as never),
    },
    {
      eventStore: createInMemorySessionEventStore(),
      eventSink: {
        onSessionEvent: (event) => {
          wiring.sessionEvents.push(event);
        },
      },
      modelFactory: wiring.model.modelFactory,
      workflowSubmitPort: input.submitPort as never,
      workflowEscalatePort: input.escalatePort as never,
      ...(input.modelRequestAdmission === undefined
        ? {}
        : { modelRequestAdmission: input.modelRequestAdmission as never }),
      fileSystemPort: wiring.fileSystemPort,
    },
  );
}

export async function runFaultCell(options: FaultCellOptions): Promise<FaultCellObservation> {
  const shape = FAULT_MATRIX_SHAPES[options.shape];
  const wiring = wireCell(options);
  const runId = `fault-${options.shape.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  try {
    const result = await runDriverScript(shape.script, {
      actorScripts: {},
      caps: { maxConcurrency: 16 },
      clock: wiring.clock,
      concurrency: wiring.governor,
      runId,
      runtimeFactory: ({ sessionId, persona, submitPort, escalatePort, modelRequestAdmission }) =>
        makeActorRuntime(wiring, {
          sessionId,
          persona,
          submitPort,
          escalatePort,
          modelRequestAdmission,
        }),
      timeoutMs: options.timeoutMs ?? FAULT_CELL_TIMEOUT_MS,
    });
    const settledAt = Date.now();
    return {
      runId,
      settlement: result.settlement,
      events: result.events,
      statusEvents: wiring.statusEvents,
      sessionEvents: wiring.sessionEvents,
      governor: wiring.governor,
      key: FAULT_CONCURRENCY_KEY,
      journal: result.journal,
      settledAt,
      shape,
      logicalRequests: shape.asks * ((options.turns ?? FAULT_CELL_TURNS) + 1),
    };
  } finally {
    wiring.model.dispose();
  }
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

export interface FaultServiceHarness {
  service: DynamicWorkflowRunService;
  
  journal: InMemoryJournalStore;
  runEvents: DynamicWorkflowRunProgressPayload[];
  statusEvents: ModelNetworkStatusEvent[];
  sessionEvents: SessionEvent[];
  governor: WorkflowConcurrencyGovernor;
  key: string;
  cwd: string;
  parentSessionId: string;
  
  submit(shape: ScriptShape): Promise<string>;
  
  settle(runId: string): Promise<DynamicWorkflowRunSnapshot | undefined>;
  
  settledAt(runId: string): number | undefined;
  
  eventsOf(runId: string): RunEvent[];
  dispose(): Promise<void>;
}

interface FaultServiceHarnessOptions extends Omit<FaultCellOptions, "shape"> {
  
  journal?: InMemoryJournalStore;
}

export function createFaultServiceHarness(
  options: FaultServiceHarnessOptions,
): FaultServiceHarness {
  const wiring = wireCell(options);
  const journal = options.journal ?? new InMemoryJournalStore();
  const runEvents: DynamicWorkflowRunProgressPayload[] = [];
  const settledAtByRun = new Map<string, number>();
  const parentSessionId = `fault-parent-${randomUUID().slice(0, 8)}`;
  const cwd = mkdtempSync(join(tmpdir(), "dwf-fault-matrix-"));
  let submitted = 0;

  const service = createDynamicWorkflowRunService({
    concurrency: wiring.governor,
    createActorRuntime: (input) => {
      const runtime = makeActorRuntime(wiring, {
        sessionId: input.sessionId,
        persona: input.persona,
        submitPort: input.submitPort,
        escalatePort: input.escalatePort,
        modelRequestAdmission: input.modelRequestAdmission,
      });
      runtime.resumeFromStore = async () => ({ resumed: true }) as never;
      return runtime;
    },
    driverClock: wiring.clock,
    executionPort: unsupportedExecutionPort(),
    fileSystemPort: wiring.fileSystemPort,
    journal,
    onRunEvent: (progress) => {
      runEvents.push(progress);
      if (progress.eventType === "run-settled" && !settledAtByRun.has(progress.runId)) {
        settledAtByRun.set(progress.runId, Date.now());
      }
    },
    parentSessionId,
  });

  return {
    service,
    journal,
    runEvents,
    statusEvents: wiring.statusEvents,
    sessionEvents: wiring.sessionEvents,
    governor: wiring.governor,
    key: FAULT_CONCURRENCY_KEY,
    cwd,
    parentSessionId,
    async submit(shape) {
      submitted += 1;
      const name = `fault-${shape.toLowerCase()}-${submitted}`;
      const sessionId = createSessionId(parentSessionId);
      const result = await service.submit({
        cwd,
        parentSessionId,
        scriptText: FAULT_MATRIX_SHAPES[shape].script,
        toolCallId: createToolCallId(`${name}-call`),
        trace: createRootTraceContext({ sessionId, turnId: createTurnId(name) }),
      });
      if (!result.ok) throw new Error(`fault matrix submit refused: ${result.reason}`);
      return result.runId;
    },
    settle(runId) {
      return service.waitForTask(runId);
    },
    settledAt(runId) {
      return settledAtByRun.get(runId);
    },
    eventsOf(runId) {
      return runEvents
        .filter((progress) => progress.runId === runId)
        .map((progress) => ({ type: progress.eventType, ...progress.payload }) as RunEvent);
    },
    async dispose() {
      wiring.model.dispose();
    },
  };
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

interface CommonInvariantExpectation {
  status: "completed" | "stopped" | "errored";
  stopReason?: RunStopReason;
  server: FakeProviderServer;
  
  defaultConcurrency?: number;
  
  submitPayload?: unknown;
}

export function askNodes(journal: JournalStorePort, runId: string): NodeRecord[] {
  return journal
    .listNodes(runId, { kinds: "all", withResult: true })
    .filter((node) => node.siteId.startsWith("ask#"));
}

export function assertCommonInvariants(
  observation: Pick<
    FaultCellObservation,
    "runId" | "settlement" | "events" | "statusEvents" | "settledAt"
  > & { journal: JournalStorePort },
  expectation: CommonInvariantExpectation,
): void {
  const { runId, settlement, events, statusEvents, journal, settledAt } = observation;
  const { server } = expectation;

  expect(settlement.status).toBe(expectation.status);
  if (expectation.stopReason !== undefined) {
    expect(settlement.status === "stopped" ? settlement.reason : undefined).toBe(
      expectation.stopReason,
    );
  }
  expect(journal.getRun(runId)?.status).toBe(expectation.status);

  const nodes = askNodes(journal, runId);
  expect(nodes.length).toBeGreaterThan(0);
  if (expectation.status === "completed") {
    for (const node of nodes) {
      expect(node.status, `ask node ${node.siteId}@${node.ordinal}`).toBe("completed");
      expect(node.result).toEqual(expectation.submitPayload ?? { note: "done" });
    }
  } else {
    for (const node of nodes) {
      expect(["completed", "running"], `ask node ${node.siteId}@${node.ordinal}`).toContain(
        node.status,
      );
    }
  }

  const failedSettlements = eventsOfType(events, "node-settled").filter(
    (event) => event.outcome === "failed",
  );
  expect(failedSettlements).toEqual([]);
  const run = journal.getRun(runId);
  expect(run?.failure?.code).not.toBe("DriverError");

  const failed = statusEvents.filter(
    (event): event is Extract<ModelNetworkStatusEvent, { type: "model_request_failed" }> =>
      event.type === "model_request_failed",
  );
  const scheduledByRequest = new Map<string, number>();
  for (const event of statusEvents) {
    if (event.type !== "model_retry_scheduled") continue;
    scheduledByRequest.set(event.requestId, (scheduledByRequest.get(event.requestId) ?? 0) + 1);
  }
  const retryableFailed = failed.filter((event) => event.retryable);
  for (const event of retryableFailed) {
    expect(
      scheduledByRequest.get(event.requestId) ?? 0,
      `retryable failure ${event.requestId} (${event.reason}) has a retry_scheduled`,
    ).toBeGreaterThan(0);
  }
  const terminalFailed = failed.filter(
    (event) =>
      !event.retryable && event.streamOutputCommitted !== true && event.reason !== "cancelled",
  );
  if (!(expectation.status === "stopped" && expectation.stopReason === "provider")) {
    expect(terminalFailed).toEqual([]);
  }

  const late = server.requests.filter((entry) => entry.at > settledAt + STOP_WIRE_GRACE_MS);
  const cancelledEchoes = failed.filter((event) => event.reason === "cancelled").length;
  expect(
    late.length,
    `requests arriving after run-settled (${late.length}) must all be cancel echoes (${cancelledEchoes})`,
  ).toBeLessThanOrEqual(cancelledEchoes);

  expect(server.inFlightPeak).toBeLessThanOrEqual(
    WORKFLOW_CONCURRENCY_AUTO_GROWTH_FACTOR *
      (expectation.defaultConcurrency ?? FAULT_CELL_DEFAULT_CONCURRENCY),
  );
}

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
