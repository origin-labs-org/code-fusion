import type { WorkflowToolEntrypoints } from "./contract.js";
import type { ToolRegistry } from "../registry.js";

export function exampleWorkflowToolEntrypoints(
  registry: Pick<ToolRegistry, "register">,
  entries: WorkflowToolEntrypoints,
): void {
  registry.register(entries.amendWorkflow);
  registry.register(entries.listModels);
  registry.register(entries.fillWorkflowHole);
}
