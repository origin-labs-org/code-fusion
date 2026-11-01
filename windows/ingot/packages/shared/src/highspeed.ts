import { z } from "zod";
import {
  modelExecutionSelectionFallbackReasonSchema,
  type ModelExecutionSelectionFallback,
} from "./model-execution.js";
import type { ModelSelection } from "./model-selection.js";
import { BUILTIN_MODEL_PROVIDER_IDS } from "./model-provider-types.js";

export const HIGHSPEED_CARD_EXPIRED_PROVIDER_ERROR_CODE = "3402";

export const HIGHSPEED_PROVIDER_IDS = {
  zai: "account:zai-highspeed-card",
  bigmodel: "account:bigmodel-highspeed-card",
} as const;

export function resolveHighspeedProviderId(
  family: "zai" | "bigmodel",
): (typeof HIGHSPEED_PROVIDER_IDS)[typeof family] {
  return HIGHSPEED_PROVIDER_IDS[family];
}

export function isHighspeedProviderId(providerId: string | undefined): boolean {
  if (providerId === undefined) return false;
  return Object.values(HIGHSPEED_PROVIDER_IDS).some((id) => id === providerId);
}

export const HIGHSPEED_DRAW_PROVIDER_IDS = {
  zai: "builtin:zai-coding-plan",
  bigmodel: "builtin:bigmodel-coding-plan",
} as const;

const HIGHSPEED_DRAW_PROVIDER_ID_BY_PROVIDER_ID = new Map<string, string>([
  [BUILTIN_MODEL_PROVIDER_IDS.zaiIndividualCodingPlan, HIGHSPEED_DRAW_PROVIDER_IDS.zai],
  [BUILTIN_MODEL_PROVIDER_IDS.zaiTeamCodingPlan, HIGHSPEED_DRAW_PROVIDER_IDS.zai],
  [BUILTIN_MODEL_PROVIDER_IDS.bigmodelIndividualCodingPlan, HIGHSPEED_DRAW_PROVIDER_IDS.bigmodel],
  [BUILTIN_MODEL_PROVIDER_IDS.bigmodelTeamCodingPlan, HIGHSPEED_DRAW_PROVIDER_IDS.bigmodel],
]);

export function resolveHighspeedDrawProviderId(providerId: string): string | null {
  return HIGHSPEED_DRAW_PROVIDER_ID_BY_PROVIDER_ID.get(providerId) ?? null;
}

export const highspeedCardSchema = z.object({
  card_id: z.string().min(1),
  task_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  issued_at: z.number().int().nonnegative(),
  expires_at: z.number().int().nonnegative(),
});

export const highspeedMessageMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    cardId: z.string().min(1),
    taskId: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    
    regularTps: z.number().positive().optional(),
    
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    
    highspeedTps: z.number().positive().optional(),
    savedDurationMs: z.number().nonnegative().optional(),
    
    modelDurationMs: z.number().nonnegative().optional(),
    toolDurationMs: z.number().nonnegative().optional(),
    otherDurationMs: z.number().nonnegative().optional(),
    
    fallbackAt: z.number().int().nonnegative().optional(),
    
    fallbackReason: modelExecutionSelectionFallbackReasonSchema.optional(),
  })
  .strict();

export const highspeedDrawRequestSchema = z.object({
  task_id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
});

export const highspeedDrawResponseSchema = z.object({
  code: z.number().int(),
  msg: z.string(),
  data: z.object({
    card: highspeedCardSchema.nullable(),
    next_draw_at: z.number().int().nonnegative(),
  }),
});

export const highspeedHealthyResponseSchema = z.object({
  code: z.number().int(),
  msg: z.string(),
  data: z.object({
    card_id: z.string().min(1),
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    duration_seconds: z.number().int().nonnegative(),
  }),
});

export type HighspeedCardApi = z.infer<typeof highspeedCardSchema>;
export type HighspeedMessageMeta = z.infer<typeof highspeedMessageMetaSchema>;
export type HighspeedDrawRequest = z.infer<typeof highspeedDrawRequestSchema>;
export type HighspeedDrawResponse = z.infer<typeof highspeedDrawResponseSchema>;
export type HighspeedHealthyResponse = z.infer<typeof highspeedHealthyResponseSchema>;

export interface HighspeedCardUsage {
  cardId: string;
  promptTokens: number;
  completionTokens: number;
  durationSeconds: number;
}

export interface HighspeedCardSnapshot {
  cardId: string;
  taskId: string;
  provider: string;
  model: string;
  issuedAt: number;
  expiresAt: number;
  regularTps?: number;
}

export type HighspeedPrepareFallbackReason =
  | "automation"
  | "cooldown"
  | "draw-miss"
  | "draw-timeout"
  | "expired"
  | "foreign-card"
  | "no-coding-plan"
  | "unavailable";

export interface HighspeedPrepareTurnParams {
  taskId: string;
  
  providerId: string;
  
  model: string;
  
  reasoningLevel?: string;
  
  automationId?: string;
  waitBudgetMs?: number;
}

export interface HighspeedTurnExecution {
  modelSelection: ModelSelection;
  requestAuth: { apiKey: string; headers: Record<string, string> };
  
  selectionFallback: ModelExecutionSelectionFallback;
}

export type HighspeedPrepareTurnResult =
  | {
      kind: "accelerated";
      card: HighspeedCardSnapshot;
      nextDrawAt: number;
      
      execution?: HighspeedTurnExecution;
    }
  | {
      kind: "fallback";
      reason: HighspeedPrepareFallbackReason;
      card?: HighspeedCardSnapshot;
      nextDrawAt: number | null;
    };

export interface HighspeedServiceSnapshot {
  card: HighspeedCardSnapshot | null;
  nextDrawAt: number | null;
  drawing: boolean;
}

export type HighspeedMockScenario =
  | "hit-fast"
  | "miss"
  | "hit-after-timeout"
  | "hit-invalid-model"
  | "hit-queue-edit"
  | "existing-foreign-task-card"
  | "expired-card";
