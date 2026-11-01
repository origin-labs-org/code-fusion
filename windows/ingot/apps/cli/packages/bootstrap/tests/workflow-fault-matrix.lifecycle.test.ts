// ============================================================
// ============================================================

import { describe, expect, it } from "vitest";
import type { RunEvent } from "@origin-ai/cf-dynamic-workflow";
import { startFakeProviderServer, type FaultProgram } from "./helpers/fake-provider-server.js";
import { AUTH_401, BUSY_3008, SERVE, always, healthy } from "./helpers/fault-programs.js";
import {
  FAULT_CELL_STALL_AFTER_MS,
  FAULT_CELL_TURNS,
  askNodes,
  assertCommonInvariants,
  createFaultServiceHarness,
  pause,
  statusCount,
  type FaultServiceHarness,
} from "./helpers/fault-matrix.js";
import {
  CELL_TIMEOUT_MS,
  POST_SETTLE_GRACE_MS,
  cellName,
  cells,
  type CellCoordinate,
} from "./helpers/fault-matrix-cells.js";
import { FAULT_MATRIX_SHAPES } from "./helpers/fault-matrix-scripts.js";

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(20);
  }
}

function settledEvents(
  harness: FaultServiceHarness,
  runId: string,
): Extract<RunEvent, { type: "run-settled" }>[] {
  return harness
    .eventsOf(runId)
    .filter(
      (event): event is Extract<RunEvent, { type: "run-settled" }> => event.type === "run-settled",
    );
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B15 flip — provider 停下后 resume 从断点续跑", () => {
  it.each(
    cells([{ shape: "W4" }], [{ shape: "S-phase" }]).map((cell) => [cellName(cell), cell] as const),
  )(
    "%s：第一段 stopped(provider)；翻转后 resume 完成，已完结 ask 不再请求",
    async (_name, cell: CellCoordinate) => {
      const turns = FAULT_CELL_TURNS;
      const firstSegment: FaultProgram = (request) =>
        request.ordinal <= turns + 1 ? SERVE : AUTH_401;
      const server = await startFakeProviderServer({ program: firstSegment });
      const harness = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
      });
      try {
        const runId = await harness.submit(cell.shape);
        const first = await harness.settle(runId);
        await pause(POST_SETTLE_GRACE_MS);
        expect(first?.runStatus).toBe("stopped");
        expect(first?.stopReason).toBe("provider");
        const settledAt = harness.settledAt(runId);
        expect(settledAt).toBeDefined();
        assertCommonInvariants(
          {
            runId,
            settlement: { status: "stopped", reason: "provider" },
            events: harness.eventsOf(runId),
            statusEvents: harness.statusEvents,
            journal: harness.journal,
            settledAt: settledAt!,
          },
          { status: "stopped", stopReason: "provider", server },
        );
        const completedBefore = askNodes(harness.journal, runId).filter(
          (node) => node.status === "completed",
        ).length;
        const requestsBefore = server.requests.length;
        const asks = FAULT_MATRIX_SHAPES[cell.shape].asks;
        expect(completedBefore).toBeLessThan(asks);

        server.setProgram(healthy());
        const resume = harness.service.resume;
        const resumed = await resume!(runId);
        expect(resumed).toMatchObject({ ok: true, runId });
        await waitFor(
          () => settledEvents(harness, runId).length >= 2,
          CELL_TIMEOUT_MS - 5_000,
          "second run-settled",
        );
        await pause(POST_SETTLE_GRACE_MS);
        const second = await harness.service.getTask(runId);
        expect(second?.runStatus).toBe("completed");
        const settled = settledEvents(harness, runId);
        expect(settled).toHaveLength(2);
        expect(settled[1]).toMatchObject({ status: "completed" });

        const secondSegment = server.requests.length - requestsBefore;
        expect(secondSegment).toBe((asks - completedBefore) * (turns + 1));
        for (const node of askNodes(harness.journal, runId)) {
          expect(node.status).toBe("completed");
        }
        const lateFailures = harness.statusEvents.filter(
          (event) =>
            event.type === "model_request_failed" &&
            event.reason !== "cancelled" &&
            Date.parse(event.timestamp) > settledAt!,
        );
        expect(lateFailures).toEqual([]);
      } finally {
        await harness.dispose();
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B16 stall — 无一次成功的重试段恰好通知一次", () => {
  it.each(cells([{ shape: "W4" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：一条 run-stalled（sinceMs ≥ 窗、reason rate_limited）；翻转后 completed 且不再 stall",
    async (_name, cell: CellCoordinate) => {
      const server = await startFakeProviderServer({ program: always(BUSY_3008) });
      const harness = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
      });
      try {
        const runId = await harness.submit(cell.shape);
        const stalled = () =>
          harness.eventsOf(runId).filter((event) => event.type === "run-stalled");
        await waitFor(() => stalled().length >= 1, 10_000, "run-stalled");
        await pause(FAULT_CELL_STALL_AFTER_MS + 100);
        expect(stalled()).toHaveLength(1);
        const info = stalled()[0] as Extract<RunEvent, { type: "run-stalled" }>;
        expect(info.reason).toBe("rate_limited");
        expect(info.cap).toBeDefined();
        expect(info.sinceMs).toBeGreaterThan(0);
        expect(statusCount(harness.statusEvents, "model_request_completed")).toBe(0);
        expect(statusCount(harness.statusEvents, "model_retry_scheduled")).toBeGreaterThan(0);

        server.setProgram(healthy());
        const snapshot = await harness.settle(runId);
        await pause(POST_SETTLE_GRACE_MS);
        expect(snapshot?.runStatus).toBe("completed");
        expect(stalled()).toHaveLength(1);
        assertCommonInvariants(
          {
            runId,
            settlement: { status: "completed", artifact: undefined },
            events: harness.eventsOf(runId),
            statusEvents: harness.statusEvents,
            journal: harness.journal,
            settledAt: harness.settledAt(runId)!,
          },
          { status: "completed", server },
        );
      } finally {
        await harness.dispose();
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B17 cancel — 退避中取消立即停下", () => {
  it.each(cells([{ shape: "W8" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：stopped(user)，取消到结算 ≤ 1 s，结算后零请求",
    async (_name, cell: CellCoordinate) => {
      const server = await startFakeProviderServer({ program: always(BUSY_3008) });
      const harness = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
      });
      try {
        const runId = await harness.submit(cell.shape);
        await waitFor(
          () => statusCount(harness.statusEvents, "model_retry_scheduled") >= 1,
          10_000,
          "first retry_scheduled",
        );
        const cancelledAt = Date.now();
        expect(await harness.service.cancel(runId, "user")).toBe(true);
        const snapshot = await harness.settle(runId);
        const settledAt = harness.settledAt(runId);
        expect(settledAt).toBeDefined();
        expect(settledAt! - cancelledAt).toBeLessThanOrEqual(1_000);
        expect(snapshot?.runStatus).toBe("stopped");
        expect(snapshot?.stopReason).toBe("user");
        await pause(POST_SETTLE_GRACE_MS);
        assertCommonInvariants(
          {
            runId,
            settlement: { status: "stopped", reason: "user" },
            events: harness.eventsOf(runId),
            statusEvents: harness.statusEvents,
            journal: harness.journal,
            settledAt: settledAt!,
          },
          { status: "stopped", stopReason: "user", server },
        );
        expect(statusCount(harness.statusEvents, "model_request_completed")).toBe(0);
        const after = server.requests.length;
        await pause(500);
        expect(server.requests.length).toBe(after);
      } finally {
        await harness.dispose();
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B18 close — 宿主关闭停下自己拥有的 run，下一次激活可续跑", () => {
  it.each(cells([{ shape: "W4" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：stopped(interrupted) 在 close 解析前写完；之后零事件；同一份 journal 上 resume 完成",
    async (_name, cell: CellCoordinate) => {
      const server = await startFakeProviderServer({ program: always(BUSY_3008) });
      const first = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
      });
      const journal = first.journal;
      let runId = "";
      try {
        runId = await first.submit(cell.shape);
        await waitFor(
          () => statusCount(first.statusEvents, "model_retry_scheduled") >= 1,
          10_000,
          "first retry_scheduled",
        );

        await first.service.close();

        const snapshot = await first.service.getTask(runId);
        expect(snapshot?.runStatus).toBe("stopped");
        expect(snapshot?.stopReason).toBe("interrupted");
        expect(journal.getRun(runId)?.failure?.code).toBe("Interrupted");
        const settled = settledEvents(first, runId);
        expect(settled).toHaveLength(1);
        expect(settled[0]).toMatchObject({ status: "stopped", stopReason: "interrupted" });

        const settledAt = first.settledAt(runId);
        expect(settledAt).toBeDefined();
        const eventsAtClose = first.runEvents.length;
        const requestsStartedAtClose = statusCount(first.statusEvents, "model_request_started");
        expect(requestsStartedAtClose).toBeGreaterThan(0);
        await pause(POST_SETTLE_GRACE_MS);
        expect(first.runEvents.length).toBe(eventsAtClose);
        expect(statusCount(first.statusEvents, "model_request_started")).toBe(
          requestsStartedAtClose,
        );
        assertCommonInvariants(
          {
            runId,
            settlement: { status: "stopped", reason: "interrupted" },
            events: first.eventsOf(runId),
            statusEvents: first.statusEvents,
            journal,
            settledAt: settledAt!,
          },
          { status: "stopped", stopReason: "interrupted", server },
        );

        await expect(first.service.resume!(runId)).rejects.toThrow(/service is closed/);
      } finally {
        await first.dispose();
      }

      server.setProgram(healthy());
      const second = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
        journal,
      });
      try {
        const resume = second.service.resume;
        expect(await resume!(runId)).toMatchObject({ ok: true, runId });
        await waitFor(
          () => settledEvents(second, runId).length >= 1,
          CELL_TIMEOUT_MS - 5_000,
          "run-settled after resume",
        );
        await pause(POST_SETTLE_GRACE_MS);
        expect((await second.service.getTask(runId))?.runStatus).toBe("completed");
        const record = journal.getRun(runId);
        expect(record?.status).toBe("completed");
        expect(record?.failure).toBeUndefined();
        expect(record?.stopReason).toBeUndefined();
        for (const node of askNodes(journal, runId)) {
          expect(node.status).toBe("completed");
        }
      } finally {
        await second.dispose();
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B19 foreign row — 别的进程写下的终态行压不过活着的引擎", () => {
  it.each(cells([{ shape: "W4" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：外来 stopped(interrupted) 不产生 run-settled；真正的 completed 才产生，且行不留失败",
    async (_name, cell: CellCoordinate) => {
      const server = await startFakeProviderServer({ program: always(BUSY_3008) });
      const harness = createFaultServiceHarness({
        server,
        apiFormat: cell.apiFormat ?? "anthropic-messages",
      });
      try {
        const runId = await harness.submit(cell.shape);
        await waitFor(
          () => statusCount(harness.statusEvents, "model_retry_scheduled") >= 1,
          10_000,
          "first retry_scheduled",
        );

        harness.journal.updateRunStatus(runId, "stopped", {
          stopReason: "interrupted",
          failure: { code: "Interrupted", message: "owning process exited" },
        });
        expect(harness.journal.getRun(runId)?.status).toBe("stopped");

        await pause(POST_SETTLE_GRACE_MS);
        expect(settledEvents(harness, runId)).toHaveLength(0);
        expect(harness.settledAt(runId)).toBeUndefined();
        expect((await harness.service.getTask(runId))?.status).toBe("running");

        server.setProgram(healthy());
        const snapshot = await harness.settle(runId);
        await pause(POST_SETTLE_GRACE_MS);
        expect(snapshot?.runStatus).toBe("completed");
        const settled = settledEvents(harness, runId);
        expect(settled).toHaveLength(1);
        expect(settled[0]).toMatchObject({ status: "completed" });

        const record = harness.journal.getRun(runId);
        expect(record?.status).toBe("completed");
        expect(record?.failure).toBeUndefined();
        expect(record?.stopReason).toBeUndefined();

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
      } finally {
        await harness.dispose();
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});
