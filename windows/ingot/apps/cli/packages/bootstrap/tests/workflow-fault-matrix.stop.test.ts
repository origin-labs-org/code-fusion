// ============================================================
// ============================================================

import type { ModelNetworkStatusEvent } from "@origin-ai/cf-contracts";
import { describe, expect, it } from "vitest";
import {
  startFakeProviderServer,
  type FakeProviderServer,
} from "./helpers/fake-provider-server.js";
import {
  AUTH_401,
  INVALID_REQUEST_3001,
  MODEL_NOT_FOUND_3006,
  QUOTA_1308,
  always,
  type StatusVerdict,
} from "./helpers/fault-programs.js";
import {
  FAULT_CELL_DEFAULT_CONCURRENCY,
  assertCommonInvariants,
  pause,
  runFaultCell,
  type FaultCellObservation,
} from "./helpers/fault-matrix.js";
import {
  CELL_TIMEOUT_MS,
  POST_SETTLE_GRACE_MS,
  cellName,
  cells,
  type CellCoordinate,
} from "./helpers/fault-matrix-cells.js";
import { FAULT_MODEL_ID, FAULT_PROVIDER_ID } from "./helpers/fault-provider-model.js";

const STOP_LATENCY_MS = 2_000;

interface StopRow {
  id: string;
  title: string;
  verdict: StatusVerdict;
  kind: "auth" | "quota" | "model_unavailable" | "invalid_request";
  quick: CellCoordinate[];
  fullOnly: CellCoordinate[];
}

const STOP_ROWS: StopRow[] = [
  {
    id: "B10",
    title: "认证失效 401/1006",
    verdict: AUTH_401,
    kind: "auth",
    quick: [{ shape: "W4" }, { shape: "W4", apiFormat: "openai-chat-completions" }],
    fullOnly: [{ shape: "W16" }],
  },
  {
    id: "B11",
    title: "五小时用量上限 429/1308（带 Retry-After）",
    verdict: QUOTA_1308,
    kind: "quota",
    quick: [{ shape: "W4" }],
    fullOnly: [],
  },
  {
    id: "B12",
    title: "模型不在套餐里 404/3006",
    verdict: MODEL_NOT_FOUND_3006,
    kind: "model_unavailable",
    quick: [{ shape: "W4" }],
    fullOnly: [],
  },
  {
    id: "B13",
    title: "请求不合法 400/3001",
    verdict: INVALID_REQUEST_3001,
    kind: "invalid_request",
    quick: [{ shape: "W4" }],
    fullOnly: [],
  },
];

async function runCell(
  server: FakeProviderServer,
  cell: CellCoordinate,
): Promise<FaultCellObservation> {
  const observation = await runFaultCell({
    server,
    shape: cell.shape,
    apiFormat: cell.apiFormat ?? "anthropic-messages",
  });
  await pause(POST_SETTLE_GRACE_MS);
  return observation;
}

for (const row of STOP_ROWS) {
  describe(`fault matrix · ${row.id} always(${row.verdict.status}/${row.verdict.code}) — ${row.title}`, () => {
    it.each(cells(row.quick, row.fullOnly).map((cell) => [cellName(cell), cell] as const))(
      "%s：stopped(provider)，providerStop 载荷齐全，兄弟立即被 abort，停下后零请求",
      async (_name, cell) => {
        const server = await startFakeProviderServer({ program: always(row.verdict) });
        try {
          const obs = await runCell(server, cell);
          assertCommonInvariants(obs, { status: "stopped", stopReason: "provider", server });

          expect(obs.settlement.status).toBe("stopped");
          if (obs.settlement.status !== "stopped") return;
          expect(obs.settlement.error?.code).toBe("ProviderStop");
          const details = obs.settlement.error?.providerStop;
          expect(details?.kind).toBe(row.kind);
          expect(details?.providerId).toBe(FAULT_PROVIDER_ID);
          expect(details?.modelId).toBe(FAULT_MODEL_ID);
          expect(details?.providerCode).toBe(row.verdict.code);
          expect(details?.subagent).toMatch(/^actor#/u);
          expect(details?.subagentName).toBeTruthy();
          expect(details?.rawMessage).toContain(row.verdict.message);
          if (row.kind === "quota") {
            const firstAt = server.requests[0]?.at ?? 0;
            expect(details!.resetAt! - firstAt).toBeGreaterThanOrEqual(110_000);
            expect(details!.resetAt! - firstAt).toBeLessThanOrEqual(130_000);
          } else {
            expect(details?.resetAt).toBeUndefined();
          }

          const run = obs.journal.getRun(obs.runId);
          expect(run?.status).toBe("stopped");
          expect(run?.stopReason).toBe("provider");
          expect(run?.failure?.code).toBe("ProviderStop");
          const settled = obs.events.filter((event) => event.type === "run-settled");
          expect(settled).toHaveLength(1);
          expect(settled[0]).toMatchObject({ status: "stopped", stopReason: "provider" });

          const stopResponses = server.requests.filter(
            (entry) => entry.verdict.kind === "status" && entry.servedStatus === row.verdict.status,
          );
          expect(stopResponses.length).toBeGreaterThan(0);
          expect(stopResponses.length).toBeLessThanOrEqual(FAULT_CELL_DEFAULT_CONCURRENCY);
          expect(obs.settledAt - stopResponses[0]!.at).toBeLessThanOrEqual(STOP_LATENCY_MS);
          expect(server.requests.every((entry) => entry.verdict.kind === "status")).toBe(true);
          const failed = obs.statusEvents.filter(
            (event): event is Extract<ModelNetworkStatusEvent, { type: "model_request_failed" }> =>
              event.type === "model_request_failed",
          );
          const providerFailed = failed.filter((event) => event.reason !== "cancelled");
          expect(providerFailed.length).toBeGreaterThan(0);
          expect(providerFailed.length).toBeLessThanOrEqual(stopResponses.length);
          expect(failed.every((event) => event.retryable === false)).toBe(true);
          expect(
            providerFailed.every((event) => event.providerErrorCode === row.verdict.code),
          ).toBe(true);
          expect(obs.statusEvents.some((event) => event.type === "model_retry_scheduled")).toBe(
            false,
          );
          expect(obs.governor.snapshot(obs.key)?.inFlight ?? 0).toBe(0);
          const snapshot = obs.governor.snapshot(obs.key);
          expect(snapshot?.cooldownUntil).toBeUndefined();
          expect(snapshot?.cap).toBe(snapshot?.initial);
          const resumed = obs.governor.tryAdmit("resumed-run", obs.key);
          expect(resumed).toBeDefined();
          resumed?.release();
        } finally {
          await server.close();
        }
      },
      CELL_TIMEOUT_MS,
    );
  });
}
