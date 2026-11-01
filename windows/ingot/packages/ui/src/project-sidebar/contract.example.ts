import type { IProjectService, ProjectTaskRef } from "@/project-sidebar/contract.js";

export async function exampleProjectMove(
  service: IProjectService,
  task: ProjectTaskRef,
  projectId: string,
) {
  await service.moveTask({ task, projectId });
  return service.readTree();
}
