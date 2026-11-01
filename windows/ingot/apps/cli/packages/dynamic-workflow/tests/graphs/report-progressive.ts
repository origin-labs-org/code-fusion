//
interface Plan {
  steps: string[];
}

const planner = agent("planner");
const reviewer = agent("reviewer");

const plan = await planner.ask<Plan>("draft a plan");
report({ phase: "planned", steps: plan.steps.length });

const reviews: string[] = [];
for (const step of plan.steps) {
  const verdict = await reviewer.ask<string>(step);
  report({ phase: "reviewed", step, verdict });
  reviews.push(verdict);
}

report({ phase: "done", total: reviews.length });
return reviews;
