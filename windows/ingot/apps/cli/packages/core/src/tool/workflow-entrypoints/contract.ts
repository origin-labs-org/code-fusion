import type { ToolEntry } from "../types.js";
export {
  AmendWorkflowInputSchema,
  FillWorkflowHoleInputSchema,
  ListModelsInputSchema,
} from "@origin-ai/cf-contracts";

export interface WorkflowToolEntrypoints {
  readonly amendWorkflow: ToolEntry;
  readonly listModels: ToolEntry;
  readonly fillWorkflowHole: ToolEntry;
}
