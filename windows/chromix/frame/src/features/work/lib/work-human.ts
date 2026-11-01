import type {
  WorkHumanPageV1,
  WorkHumanPhaseV1,
  WorkHumanReasonV1,
  WorkHumanRegionV1,
} from "$shared/ipc/bindings";
import type { WorkHumanFailure } from "$domain/work-human";
import * as m from "$shared/i18n/messages";

/** Display-only view of one held page; the wire projection stays in the domain. */
export type HumanPage = {
  attempt: string;
  step: string;
  generation: number;
  phase: WorkHumanPhaseV1;
  reason: WorkHumanReasonV1;
  remaining: number;
  canContinue: boolean;
  /** The wait is a short one the person may keep going. */
  canExtend: boolean;
  /** The page runs in Work's own website data: what is solved here is kept. */
  workMemory: boolean;
};

/** Why the page waits, in one sentence, person first: the takeover pane says it under the site. */
export function reasonSentence(reason: WorkHumanReasonV1, host: string): string {
  switch (reason) {
    case "sign_in":
      return m.work_human_why_sign_in({ host });
    case "challenge":
      return m.work_human_why_challenge({ host });
    case "permission":
      return m.work_human_why_permission({ host });
    case "verification":
      return m.work_human_why_verification({ host });
    case "user_decision":
      return m.work_human_why_user_decision();
    case "sensitive_effect":
      return m.work_human_why_sensitive_effect({ host });
    case "unsupported_interaction":
      return m.work_human_why_unsupported_interaction();
  }
}

/** What the person is asked to do, action first: "Solve the check on allegro.pl". */
export function needTitle(reason: WorkHumanReasonV1, host: string): string {
  switch (reason) {
    case "challenge":
    case "verification":
      return m.work_human_title_check({ host });
    case "sign_in":
      return m.work_human_title_sign_in({ host });
    case "permission":
      return m.work_human_title_permission({ host });
    case "user_decision":
      return m.work_human_title_decision({ host });
    case "sensitive_effect":
      return m.work_human_title_sensitive({ host });
    case "unsupported_interaction":
      return m.work_human_title_hand({ host });
  }
}

/** One calm line for what a site asks of the person, and the one button that meets it. */
export function needLine(
  reason: WorkHumanReasonV1,
  host: string,
): { text: string; action: string } {
  switch (reason) {
    case "challenge":
    case "verification":
      return { text: m.work_need_wants_check({ host }), action: m.work_need_open_site({ host }) };
    case "sign_in":
      return {
        text: m.work_need_wants_sign_in({ host }),
        action: m.work_need_sign_in_site({ host }),
      };
    default:
      return { text: needTitle(reason, host), action: m.work_need_open_site({ host }) };
  }
}

/** Only a solved check is worth remembering, and only where Work keeps its own website data. */
export const remembers = (page: Pick<HumanPage, "reason" | "workMemory">) =>
  page.workMemory && (page.reason === "challenge" || page.reason === "verification");

/** A refused command is one line in the pane, in the person's words. */
export const failureLine = (failure: WorkHumanFailure) =>
  failure === "not_found" || failure === "conflict"
    ? m.work_human_gone()
    : m.work_human_unavailable();

/** What a card says once the page is no longer merely waiting. */
export function phaseLabel(phase: WorkHumanPhaseV1): string | null {
  switch (phase) {
    case "presenting":
      return m.work_human_presenting();
    case "presented":
      return m.work_human_presented();
    case "continuing":
      return m.work_human_continuing();
    default:
      return null;
  }
}

/** Whole seconds, rounded up, so the last second is shown rather than skipped. */
function secondsLeft(remaining: number): number | null {
  if (!Number.isFinite(remaining) || remaining <= 0) return null;
  return Math.max(1, Math.ceil(remaining / 1000));
}

/** Two minutes: a bot check's whole wait, and a sign-in's last stretch. */
const NEAR = 120_000;

/** How long the person still has, as a clock reads it: "1:05 left". The pane always shows it. */
export function countdownLabel(remaining: number): string | null {
  const seconds = secondsLeft(remaining);
  if (seconds === null) return null;
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return m.work_human_time_left({ time });
}

/** The card is quiet about a long wait: the countdown only appears near the end. */
export const cardCountdown = (remaining: number) =>
  remaining < NEAR ? countdownLabel(remaining) : null;

/** Still held for a person: `reading` and `released` are the agent's again. */
const HELD: readonly WorkHumanPhaseV1[] = [
  "waiting_for_human",
  "presenting",
  "presented",
  "continuing",
];
const RANK = (phase: WorkHumanPhaseV1) => HELD.indexOf(phase);

/** One card shows one state: the page furthest into a takeover wins. */
export function heldPage(pages: readonly WorkHumanPageV1[]): WorkHumanPageV1 | null {
  let best: WorkHumanPageV1 | null = null;
  for (const page of pages) {
    if (RANK(page.phase) < 0) continue;
    if (!best || RANK(page.phase) > RANK(best.phase)) best = page;
  }
  return best;
}

export const humanPage = (page: WorkHumanPageV1): HumanPage => ({
  attempt: page.id.attempt,
  step: page.id.step,
  generation: page.id.generation,
  phase: page.phase,
  reason: page.reason,
  remaining: page.remaining_millis,
  canContinue: page.can_continue,
  canExtend: page.can_extend,
  workMemory: page.work_memory,
});

/** Rust floors the size only; the corner may sit at the content view's origin. */
export const MIN_REGION = 64;
const MAX_EXTENT = 8192;

/**
 * The native view is placed the way a Work pane hole is: the measured DOM box
 * is already in the window's logical points. Integers only, so a sub-pixel
 * reflow never re-presents the same region.
 */
export function regionOf(
  box: { x: number; y: number; width: number; height: number },
  parent: { width: number; height: number },
): WorkHumanRegionV1 | null {
  const x = Math.round(box.x);
  const y = Math.round(box.y);
  const width = Math.round(box.width);
  const height = Math.round(box.height);
  if (![x, y, width, height, parent.width, parent.height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0) return null;
  if (width < MIN_REGION || height < MIN_REGION) return null;
  if (x + width > MAX_EXTENT || y + height > MAX_EXTENT) return null;
  if (x + width > Math.floor(parent.width) || y + height > Math.floor(parent.height)) return null;
  return { x, y, width, height };
}
