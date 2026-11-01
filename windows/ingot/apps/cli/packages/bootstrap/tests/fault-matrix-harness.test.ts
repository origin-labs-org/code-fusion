// ============================================================
// ============================================================

import { describe, expect, it } from "vitest";
import { collectSites, createWorkflowProgram } from "@origin-ai/cf-dynamic-workflow";
import { startFakeProviderServer } from "./helpers/fake-provider-server.js";
import { healthy } from "./helpers/fault-programs.js";
import {
  FAULT_CELL_TURNS,
  assertCommonInvariants,
  createFaultServiceHarness,
  pause,
  runFaultCell,
  statusCount,
} from "./helpers/fault-matrix.js";
import { FAULT_MATRIX_SHAPES, FAULT_MATRIX_SHAPE_IDS } from "./helpers/fault-matrix-scripts.js";

describe("fault matrix harness — 脚本形状", () => {
  it.each(FAULT_MATRIX_SHAPE_IDS)("%s 过真编译，ask 站点数与形状表一致", (shape) => {
    const spec = FAULT_MATRIX_SHAPES[shape];
    const program = createWorkflowProgram(spec.script);
    const table = collectSites(program);
    expect(table.asks.length).toBeGreaterThan(0);
    expect(spec.asks).toBeGreaterThanOrEqual(table.asks.length);
  });
});

describe("fault matrix harness — B1 healthy @ W2", () => {
  it(
    "driver 级：completed，请求数 = 逻辑请求数，闸门与时钟接上",
    async () => {
      const server = await startFakeProviderServer({ program: healthy() });
      try {
        const cell = await runFaultCell({
          server,
          shape: "W2",
          apiFormat: "anthropic-messages",
        });
        await pause(200);
        assertCommonInvariants(cell, { status: "completed", server });
        expect(cell.logicalRequests).toBe(2 * (FAULT_CELL_TURNS + 1));
        expect(server.requests.length).toBe(cell.logicalRequests);
        expect(statusCount(cell.statusEvents, "model_request_completed")).toBe(cell.logicalRequests);
        expect(statusCount(cell.statusEvents, "model_request_failed")).toBe(0);
        expect(cell.governor.snapshot(cell.key)).toBeDefined();
        expect(cell.governor.snapshot(cell.key)?.inFlight).toBe(0);
      } finally {
        await server.close();
      }
    },
    30_000,
  );

  it(
    "run service 级：同一格走真 submit / waitForTask，观察面同形",
    async () => {
      const server = await startFakeProviderServer({ program: healthy() });
      const harness = createFaultServiceHarness({ server, apiFormat: "anthropic-messages" });
      try {
        const runId = await harness.submit("W2");
        const snapshot = await harness.settle(runId);
        await pause(200);
        expect(snapshot?.status).toBe("completed");
        const settledAt = harness.settledAt(runId);
        expect(settledAt).toBeDefined();
        assertCommonInvariants(
          {
            runId,
            settlement: { status: "completed", artifact: undefined },
            events: harness.eventsOf(runId),
            statusEvents: harness.statusEvents,
            journal: harness.journal,
            settledAt: settledAt!,
          },
          { status: "completed", server },
        );
        expect(server.requests.length).toBe(2 * (FAULT_CELL_TURNS + 1));
        expect(harness.eventsOf(runId).some((event) => event.type === "run-settled")).toBe(true);
      } finally {
        await harness.dispose();
        await server.close();
      }
    },
    30_000,
  );
});
