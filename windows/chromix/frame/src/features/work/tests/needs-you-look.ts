import type { WorkExecutionFact, WorkHumanPageV1, WorkStepFact } from "$shared/ipc/bindings";
import type { BoardScene } from "./board-fixtures";
import { fourHelpersScene } from "./presence-look";

export const CHECK_URL = "https://allegro.pl/listing?string=lego%2042115";

/** The four-helper run with its browser part on allegro.pl, where a bot check stopped it. */
export function checkScene(stage: "waiting" | "expired"): BoardScene {
  const scene = fourHelpersScene();
  const projection = [...scene.objectives.values()][0]!;
  const run = projection.executions[0] as WorkExecutionFact & {
    parts: Record<string, unknown>[];
  };
  run.steps = (run.steps ?? []).map((each): WorkStepFact =>
    each.id === "docs-1"
      ? {
          ...each,
          kind: { kind: "read", url: CHECK_URL },
          ...(stage === "expired"
            ? { status: "failed", note: "allegro.pl needs you to continue" }
            : {}),
        }
      : each,
  );
  run.parts = run.parts.map((part) =>
    part.id === "docs"
      ? {
          ...part,
          title: "Prices",
          goal: "Compare LEGO 42115 prices on allegro.pl",
          service: { host: "allegro.pl" },
          ...(stage === "expired"
            ? {
                state: "failed" as const,
                ended_ms: "1790620130000",
                need: {
                  kind: "retry" as const,
                  host: "allegro.pl",
                  reason: "blocked_by_check" as const,
                },
              }
            : {}),
        }
      : part,
  );
  return scene;
}

/** Rust's held page for the check, as `work_human_pages` reports it. */
export const checkPage = (remaining: number, canExtend = true): WorkHumanPageV1 => ({
  id: { attempt: "attempt", step: "docs-1", generation: 1 },
  phase: "waiting_for_human",
  reason: "challenge",
  remaining_millis: remaining,
  document_revision: "1",
  can_continue: false,
  can_extend: canExtend,
  work_memory: true,
});
