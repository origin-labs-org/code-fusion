export type Step = "welcome" | "import" | "essentials" | "launcher" | "work" | "ai" | "ready";

export const STEPS: readonly Step[] = [
  "welcome",
  "import",
  "essentials",
  "launcher",
  "work",
  "ai",
  "ready",
];

/** The steps a run walks: Work and its models only while Work and AI are on. */
export const stepsFor = (ai: boolean): readonly Step[] =>
  ai ? STEPS : STEPS.filter((step) => step !== "work" && step !== "ai");

/** Where a step stands among the ones that count, welcome being the door
 *  rather than a step: 1-based, with the total. */
export function position(step: Step, ai = true): { at: number; of: number } {
  const counted: Step[] = stepsFor(ai).filter((candidate) => candidate !== "welcome");
  return { at: counted.indexOf(step) + 1, of: counted.length };
}

export function neighbour(step: Step, by: 1 | -1, ai = true): Step | undefined {
  const steps = stepsFor(ai);
  const next = steps[steps.indexOf(step) + by];
  return next === "welcome" ? undefined : next;
}
