import type {
  WorkflowRunSaveController,
  WorkflowRunSaveSubmit,
} from "@/project-workflow/contract.js";

export function saveCompletedRun(
  controller: Pick<WorkflowRunSaveController, "save">,
  input: WorkflowRunSaveSubmit,
) {
  return controller.save(input);
}
