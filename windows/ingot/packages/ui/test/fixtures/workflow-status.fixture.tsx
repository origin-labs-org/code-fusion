import "@/styles.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import { GetWorkflowRunToolCallBlock } from "@/ToolCallBlocks/renderers/get-workflow-run.js";
import type { ToolCallBlockRenderContext } from "@/ToolCallBlocks/shared.js";
const G = 1_800_000_000_000;

const SITUATION = {
  summary:
    "Running for 15m 00s, in phase 2 of 3 (judge), 5 steps settled, 2 running (1 executing, 1 parked), last progress 40s ago.",
  generatedAt: G,
  phases: [
    {
      name: "collect",
      state: "done",
      rounds: 1,
      nodesSettled: 3,
      nodesRunning: 0,
      enteredAt: G - 900_000,
      exitedAt: G - 600_000,
    },
    {
      name: "judge",
      state: "current",
      rounds: 2,
      nodesSettled: 2,
      nodesRunning: 2,
      enteredAt: G - 600_000,
    },
    { name: "report", state: "ahead", rounds: 0, nodesSettled: 0, nodesRunning: 0 },
  ],
  subagents: [
    {
      siteId: "agent#1",
      ordinal: 1,
      name: "scout",
      state: "executing",
      phaseName: "judge",
      instructionsHead:
        "Check the release notes for regressions and list every step that changed behaviour",
      startedAt: G - 310_000,
      turn: 3,
      toolCalls: 7,
      lastTool: { name: "Bash", target: "pnpm test", at: G - 20_000 },
      stepsSettled: 2,
      stepsFailed: 0,
      tokens: 4_200,
    },
    {
      siteId: "agent#2",
      ordinal: 2,
      state: "parked",
      phaseName: "judge",
      parkedOn: "q_7",
      stepsSettled: 1,
      stepsFailed: 0,
      tokens: 900,
    },
    {
      siteId: "agent#3",
      ordinal: 3,
      name: "drafter",
      state: "waiting",
      phaseName: "judge",
      waitCause: "backoff",
      retryAfterMs: 45_000,
      waitSince: G - 65_000,
      stepsSettled: 0,
      stepsFailed: 0,
      tokens: 0,
    },
  ],
  health: {
    lastProgressAt: G - 40_000,
    concurrency: { effective: 2, cap: 4, reason: "rate_limited", since: G - 130_000 },
    consecutiveFailures: 2,
    cachedSteps: 3,
    pendingQuestionsKnown: true,
  },
  logTail: [{ sequence: 9, message: "fan-out complete", at: G - 95_000 }],
};

const STOPPED_SITUATION = {
  stopReason: "interrupted",
  summary: "Stopped 2h 15m ago in phase judge, 1 step settled, 1 still marked running.",
  generatedAt: G,
  phases: [
    {
      name: "judge",
      state: "unfinished",
      rounds: 1,
      nodesSettled: 1,
      nodesRunning: 1,
      enteredAt: G - 8_100_000,
    },
  ],
  subagents: [
    {
      siteId: "agent#1",
      ordinal: 1,
      name: "scout",
      state: "unfinished",
      phaseName: "judge",
      startedAt: G - 8_000_000,
      turn: 2,
      stepsSettled: 1,
      stepsFailed: 1,
      tokens: 1_500,
    },
  ],
  health: {
    lastProgressAt: G - 8_000_000,
    consecutiveFailures: 0,
    cachedSteps: 0,
    leftoverRunning: 1,
    pendingQuestionsKnown: false,
  },
  logTail: [],
  truncated: true,
};

function Fixture() {
  const [state, setState] = useState("fetching");
  const display = {
    kind: "get_workflow_run",
    runId: "status-run",
    label: "Status workflow",
    status:
      state === "completed"
        ? "completed"
        : state === "run-failed"
          ? "failed"
          : state === "situation-stopped"
            ? "stopped"
            : "running",
    usage: {
      spentTokens: 100,
      nodesObserved: 3,
      nodesCompleted: 1,
      nodesFailed: 0,
      nodesRunning: 2,
    },
    actors: [],
    logTail: [],
    ...(state === "completed"
      ? { result: JSON.stringify(Array.from({ length: 40 }, (_, i) => `result ${i}`)) }
      : {}),
    ...(state === "run-failed" ? { error: { code: "RUN_ERROR", message: "Actor failed" } } : {}),
    ...(state === "situation" ? SITUATION : {}),
    ...(state === "situation-stopped" ? STOPPED_SITUATION : {}),
  };
  const context = {
    toolCallNode: {
      toolCall: {
        toolId: "status",
        status: state === "query-failed" ? "failed" : "completed",
        raw: { display },
      },
      childToolCalls: [],
    },
    isRunning: state === "fetching",
    forceOpen: false,
    canToggle: true,
    errorText: state === "query-failed" ? "Query denied" : undefined,
    onOpenWorkflowRun: () => {
      document.body.dataset.open = "true";
    },
  } as unknown as ToolCallBlockRenderContext;
  return (
    <CfIntlProvider initialLocale="en-US">
      <TooltipProvider>
        {[
          "running",
          "completed",
          "run-failed",
          "query-failed",
          "situation",
          "situation-stopped",
        ].map((s) => (
          <button key={s} onClick={() => setState(s)}>
            {s}
          </button>
        ))}
        <GetWorkflowRunToolCallBlock {...context} />
      </TooltipProvider>
    </CfIntlProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
