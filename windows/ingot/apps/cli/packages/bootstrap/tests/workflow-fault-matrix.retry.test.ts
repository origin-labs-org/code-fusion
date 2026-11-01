// ============================================================
// ============================================================
//

import { SessionEventType } from "@origin-ai/cf-contracts";
import { describe, expect, it } from "vitest";
import {
  startFakeProviderServer,
  type FakeProviderServer,
  type FaultProgram,
  type RequestLedgerEntry,
  type Verdict,
} from "./helpers/fake-provider-server.js";
import {
  BUSY_3008,
  SERVE,
  UNKNOWN_1314,
  cutVisibleUntil,
  everyKth,
  failFirst,
  gate,
  healthy,
} from "./helpers/fault-programs.js";
import {
  FAULT_CELL_DEFAULT_CONCURRENCY,
  FAULT_CELL_TURNS,
  assertCommonInvariants,
  eventsOfType,
  pause,
  runFaultCell,
  statusCount,
  type FaultCellObservation,
} from "./helpers/fault-matrix.js";
import {
  CELL_TIMEOUT_MS,
  POST_SETTLE_GRACE_MS,
  cellName,
  cells,
  type CellCoordinate,
} from "./helpers/fault-matrix-cells.js";
import { FAULT_MATRIX_SHAPES } from "./helpers/fault-matrix-scripts.js";

const GATE_LIMIT = 2;

const EVERY_K = 3;

async function runCell(
  server: FakeProviderServer,
  cell: CellCoordinate,
  extra: { turns?: number } = {},
): Promise<FaultCellObservation> {
  const observation = await runFaultCell({
    server,
    shape: cell.shape,
    apiFormat: cell.apiFormat ?? "anthropic-messages",
    ...(extra.turns === undefined ? {} : { turns: extra.turns }),
  });
  await pause(POST_SETTLE_GRACE_MS);
  return observation;
}

function verdictCount(server: FakeProviderServer, predicate: (verdict: Verdict) => boolean): number {
  return server.requests.filter((entry: RequestLedgerEntry) => predicate(entry.verdict)).length;
}

function statusVerdictCount(server: FakeProviderServer, code?: string): number {
  return verdictCount(
    server,
    (verdict) => verdict.kind === "status" && (code === undefined || verdict.code === code),
  );
}

function failFirstCount(cell: CellCoordinate): number {
  return FAULT_MATRIX_SHAPES[cell.shape].parallelism * 2;
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B1 healthy — 装配基线", () => {
  it.each(
    cells(
      [{ shape: "W4" }, { shape: "S-phase" }],
      [
        { shape: "W1" },
        { shape: "W2" },
        { shape: "W8" },
        { shape: "W16" },
        { shape: "S-pipe" },
        { shape: "S-nest" },
      ],
    ).map((cell) => [cellName(cell), cell] as const),
  )(
    "%s：completed，请求数 = 逻辑请求数，零失败",
    async (_name, cell) => {
      const server = await startFakeProviderServer({ program: healthy() });
      try {
        const obs = await runCell(server, cell);
        assertCommonInvariants(obs, { status: "completed", server });
        expect(server.requests.length).toBe(obs.logicalRequests);
        expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(obs.logicalRequests);
        expect(statusCount(obs.statusEvents, "model_request_failed")).toBe(0);
      } finally {
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B2 gate(2) — 3008 在 workflow 内是重试，不是终止", () => {
  it.each(
    cells(
      [{ shape: "W4" }, { shape: "W16" }, { shape: "S-nest" }],
      [
        { shape: "W1" },
        { shape: "W2" },
        { shape: "W8" },
        { shape: "S-pipe" },
        { shape: "W8", apiFormat: "openai-chat-completions" },
      ],
    ).map((cell) => [cellName(cell), cell] as const),
  )(
    "%s：completed、零失败子代理、拒绝数有界、cap 收敛、每个 3008 配一条 retry_scheduled",
    async (_name, cell) => {
      const server = await startFakeProviderServer({ program: gate(GATE_LIMIT) });
      try {
        const obs = await runCell(server, cell);
        assertCommonInvariants(obs, { status: "completed", server });

        const rejected = statusVerdictCount(server, "3008");
        const parallelism = obs.shape.parallelism;
        const failed = obs.statusEvents.filter(
          (event) => event.type === "model_request_failed",
        );
        const scheduled = obs.statusEvents.filter(
          (event) => event.type === "model_retry_scheduled",
        );

        if (parallelism > GATE_LIMIT) {
          expect(rejected).toBeGreaterThan(0);
          expect(rejected).toBeLessThanOrEqual(parallelism * FAULT_CELL_TURNS);
          const throttles = eventsOfType(obs.events, "concurrency-changed").filter(
            (event) => event.reason === "rate_limited",
          );
          expect(throttles.length).toBeGreaterThan(0);
          expect(Math.min(...throttles.map((event) => event.next))).toBeLessThan(
            FAULT_CELL_DEFAULT_CONCURRENCY,
          );
        } else {
          expect(rejected).toBe(0);
        }

        expect(failed.length).toBe(rejected);
        expect(failed.every((event) => event.retryable === true)).toBe(true);
        expect(failed.every((event) => event.providerErrorCode === "3008")).toBe(true);
        expect(scheduled.length).toBe(rejected);
        expect(scheduled.every((event) => event.reason === "rate_limited")).toBe(true);
        expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(obs.logicalRequests);
        expect(obs.governor.snapshot(obs.key)?.inFlight).toBe(0);
      } finally {
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

interface FailFirstRow {
  id: string;
  title: string;
  status: number;
  code?: string;
  quick: CellCoordinate[];
  fullOnly: CellCoordinate[];
}

const FAIL_FIRST_ROWS: FailFirstRow[] = [
  {
    id: "B3",
    title: "普通 429 限流在内重试",
    status: 429,
    quick: [{ shape: "W4" }],
    fullOnly: [
      { shape: "W1" },
      { shape: "W2" },
      { shape: "W8" },
      { shape: "W16" },
      { shape: "S-phase" },
    ],
  },
  {
    id: "B4",
    title: "5xx 在内重试",
    status: 500,
    quick: [{ shape: "W4" }],
    fullOnly: [{ shape: "S-pipe" }],
  },
  {
    id: "B14",
    title: "分类器判不可重试的未知业务码 1314 也在内重试（决策 10）",
    status: UNKNOWN_1314.status,
    code: UNKNOWN_1314.code,
    quick: [{ shape: "W4" }],
    fullOnly: [],
  },
];

for (const row of FAIL_FIRST_ROWS) {
  describe(`fault matrix · ${row.id} failFirst(2P, ${row.status}${row.code ? ` code ${row.code}` : ""}) — ${row.title}`, () => {
    it.each(cells(row.quick, row.fullOnly).map((cell) => [cellName(cell), cell] as const))(
      "%s：completed，失败数 = N，请求数 = 逻辑请求数 + N",
      async (_name, cell) => {
        const n = failFirstCount(cell);
        const server = await startFakeProviderServer({
          program: failFirst(n, row.status, {
            ...(row.code === undefined ? {} : { code: row.code }),
            ...(row.code === undefined ? {} : { message: UNKNOWN_1314.message }),
          }),
        });
        try {
          const obs = await runCell(server, cell);
          assertCommonInvariants(obs, { status: "completed", server });
          expect(statusVerdictCount(server)).toBe(n);
          expect(statusCount(obs.statusEvents, "model_request_failed")).toBe(n);
          expect(statusCount(obs.statusEvents, "model_retry_scheduled")).toBe(n);
          expect(server.requests.length).toBe(obs.logicalRequests + n);
          expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(
            obs.logicalRequests,
          );
          if (row.code !== undefined) {
            const failed = obs.statusEvents.filter(
              (event) => event.type === "model_request_failed",
            );
            expect(failed.every((event) => event.providerErrorCode === row.code)).toBe(true);
          }
        } finally {
          await server.close();
        }
      },
      CELL_TIMEOUT_MS,
    );
  });
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

interface EveryKthRow {
  id: string;
  title: string;
  verdict: Verdict;
  
  program?: (cell: CellCoordinate) => FaultProgram;
  quick: CellCoordinate[];
  fullOnly: CellCoordinate[];
}

const EVERY_KTH_ROWS: EveryKthRow[] = [
  {
    id: "B5",
    title: "连接重置在内重试",
    verdict: { kind: "reset" },
    quick: [{ shape: "W4" }],
    fullOnly: [{ shape: "W8" }],
  },
  {
    id: "B6",
    title: "挂起 → 流空闲超时 → 在内重试",
    verdict: { kind: "hang" },
    program: (cell) => {
      const parallelism = FAULT_MATRIX_SHAPES[cell.shape].parallelism;
      return (request) => (request.ordinal <= parallelism ? { kind: "hang" } : SERVE);
    },
    quick: [],
    fullOnly: [{ shape: "W4" }],
  },
  {
    id: "B7",
    title: "可见输出之前切断 → runner 重试（决策 25 允许）",
    verdict: { kind: "cut", after: "message_start" },
    quick: [{ shape: "W4" }],
    fullOnly: [{ shape: "W4", apiFormat: "openai-chat-completions" }],
  },
];

for (const row of EVERY_KTH_ROWS) {
  const rowCells = cells(row.quick, row.fullOnly);
  describe.skipIf(rowCells.length === 0)(`fault matrix · ${row.id} everyKth(${EVERY_K}, ${row.verdict.kind}) — ${row.title}`, () => {
    it.each(rowCells.map((cell) => [cellName(cell), cell] as const))(
      "%s：completed，失败数 = 吃到判决的请求数",
      async (_name, cell) => {
        const server = await startFakeProviderServer({
          program: row.program?.(cell) ?? everyKth(EVERY_K, row.verdict),
        });
        try {
          const obs = await runCell(server, cell);
          assertCommonInvariants(obs, { status: "completed", server });
          const faulted = verdictCount(server, (verdict) => verdict.kind === row.verdict.kind);
          expect(faulted).toBeGreaterThan(0);
          expect(statusCount(obs.statusEvents, "model_request_failed")).toBe(faulted);
          expect(statusCount(obs.statusEvents, "model_retry_scheduled")).toBe(faulted);
          expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(
            obs.logicalRequests,
          );
          expect(server.requests.length).toBe(obs.logicalRequests + faulted);
          if (row.verdict.kind === "hang") {
            const hung = server.requests.filter((entry) => entry.verdict.kind === "hang");
            expect(hung.every((entry) => entry.closedByClient)).toBe(true);
          }
        } finally {
          await server.close();
        }
      },
      CELL_TIMEOUT_MS,
    );
  });
}

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B8a everyKth(3, cut:visible) — 可见输出后切断由 core 流恢复接上", () => {
  it.each(cells([{ shape: "W4" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：completed，runner 不重放，会话里有流恢复记录，零 driver 重驱",
    async (_name, cell) => {
      const server = await startFakeProviderServer({
        program: everyKth(EVERY_K, { kind: "cut", after: "visible" }),
      });
      try {
        const obs = await runCell(server, cell);
        assertCommonInvariants(obs, { status: "completed", server });
        const cut = verdictCount(server, (verdict) => verdict.kind === "cut");
        expect(cut).toBeGreaterThan(0);
        const committedFailures = obs.statusEvents.filter(
          (event) => event.type === "model_request_failed" && event.streamOutputCommitted === true,
        );
        expect(committedFailures.length).toBe(cut);
        expect(statusCount(obs.statusEvents, "model_retry_scheduled")).toBe(0);
        const recoveries = obs.sessionEvents.filter(
          (event) => event.type === SessionEventType.StreamRecoveryStarted,
        );
        expect(recoveries.length).toBeGreaterThan(0);
        const backoffs = eventsOfType(obs.events, "node-waiting").filter(
          (event) => event.cause === "backoff",
        );
        expect(backoffs).toEqual([]);
        expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(obs.logicalRequests);
      } finally {
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

describe("fault matrix · B8b cutVisibleUntil(n) — 流恢复耗尽后 driver 瞬态重驱", () => {
  
  const CUTS = 11;
  
  it.each(cells([{ shape: "W1" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：completed，恰好一次 askWaiting{backoff}，续接之后完成",
    async (_name, cell) => {
      const server = await startFakeProviderServer({
        program: cutVisibleUntil(CUTS),
        canned: { turns: 1 },
      });
      try {
        const obs = await runCell(server, cell, { turns: 1 });
        assertCommonInvariants(obs, { status: "completed", server });
        expect(verdictCount(server, (verdict) => verdict.kind === "cut")).toBe(CUTS);
        const backoffs = eventsOfType(obs.events, "node-waiting").filter(
          (event) => event.cause === "backoff",
        );
        expect(backoffs.length).toBeGreaterThanOrEqual(1);
        expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(obs.logicalRequests);
        expect(server.requests.length).toBe(obs.logicalRequests + CUTS);
      } finally {
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});

// ————————————————————————————————————————————————————————————————
// ————————————————————————————————————————————————————————————————

describe("fault matrix · B9 everyKth(3, stream_error 3008) — 流内业务码走同一策略", () => {
  it.each(cells([{ shape: "W4" }]).map((cell) => [cellName(cell), cell] as const))(
    "%s：completed，每个流内 3008 配一条 retry_scheduled{rate_limited}",
    async (_name, cell) => {
      const server = await startFakeProviderServer({
        program: everyKth(EVERY_K, {
          kind: "stream_error",
          code: BUSY_3008.code!,
          message: BUSY_3008.message!,
        }),
      });
      try {
        const obs = await runCell(server, cell);
        assertCommonInvariants(obs, { status: "completed", server });
        const errored = verdictCount(server, (verdict) => verdict.kind === "stream_error");
        expect(errored).toBeGreaterThan(0);
        const failed = obs.statusEvents.filter((event) => event.type === "model_request_failed");
        expect(failed.length).toBe(errored);
        expect(failed.every((event) => event.retryable === true)).toBe(true);
        expect(failed.every((event) => event.providerErrorCode === "3008")).toBe(true);
        const scheduled = obs.statusEvents.filter(
          (event) => event.type === "model_retry_scheduled",
        );
        expect(scheduled.length).toBe(errored);
        expect(scheduled.every((event) => event.reason === "rate_limited")).toBe(true);
        expect(statusCount(obs.statusEvents, "model_request_completed")).toBe(obs.logicalRequests);
      } finally {
        await server.close();
      }
    },
    CELL_TIMEOUT_MS,
  );
});
