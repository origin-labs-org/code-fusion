import type { TaskFactsContract, TaskFactTarget } from "#src/task-facts/contract.js";

export async function renameTaskExample(facts: TaskFactsContract, target: TaskFactTarget) {
  return facts.mutate(target, { type: "rename", title: "Review project" });
}
