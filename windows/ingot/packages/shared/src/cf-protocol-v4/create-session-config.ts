import { z } from "zod";
import { modelSelectionSchema } from "../model-selection.js";

export const createSessionRequestedConfigSchema = z.object({
  modelSelection: modelSelectionSchema.optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  thought: z.string().optional(),
  followupMode: z.enum(["queue", "guide"]).optional(),
  mode: z.string().optional(),
  planEnabled: z.boolean().optional(),
});
