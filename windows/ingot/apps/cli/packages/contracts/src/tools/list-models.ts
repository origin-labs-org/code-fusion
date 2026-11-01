// ============================================================
// ============================================================
//
//
// （{@link import("../interfaces/model-catalog.port.js").ModelCatalogPort}）。

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const LIST_MODELS_TOOL_NAME = "ListModels";

export const ListModelsInputSchema = z
  .object({})
  .strict();

export type ListModelsInput = z.infer<typeof ListModelsInputSchema>;

export const ListModelsInputJsonSchema = toToolJsonSchema(ListModelsInputSchema);

export const ListModelsEntrySchema = z
  .object({
    
    id: z.string(),
    providerId: z.string(),
    modelId: z.string(),
    
    providerLabel: z.string().optional(),
    
    reasoningLevels: z.array(z.string()),
    
    defaultReasoningLevel: z.string().optional(),
    contextWindow: z.number().optional(),
    
    disabledReason: z.string().optional(),
  })
  .strict();

export type ListModelsEntry = z.infer<typeof ListModelsEntrySchema>;

export const ListModelsOutputSchema = z
  .object({
    
    current: z.string().optional(),
    models: z.array(ListModelsEntrySchema),
  })
  .strict();

export type ListModelsOutput = z.infer<typeof ListModelsOutputSchema>;

export const ListModelsOutputJsonSchema = toToolJsonSchema(ListModelsOutputSchema);
