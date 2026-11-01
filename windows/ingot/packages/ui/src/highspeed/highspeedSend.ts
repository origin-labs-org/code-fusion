import type {
  HighspeedCardSnapshot,
  HighspeedMessageMeta,
  HighspeedPrepareTurnResult,
  ModelSelection,
} from "@origin-ai/cf-shared";
import type { CommandPayloadMap } from "@origin-ai/cf-shared/cf-protocol-v4";

type HighspeedModelExecution = NonNullable<CommandPayloadMap["sendText"]["modelExecution"]>;

export type HighspeedTurnPreparer = (
  taskId: string,
  submissionSelection?: ModelSelection,
) => Promise<HighspeedPrepareTurnResult | null>;

export interface HighspeedPrepareSelectionSource {
  readonly provider?: string;
  readonly model?: string;
  readonly thought?: string;
  readonly modelSelection?: ModelSelection;
}

export function resolveHighspeedPrepareSelection(input: {
  submissionSelection?: ModelSelection;
  projectedConfig?: HighspeedPrepareSelectionSource | null;
  draftConfig?: HighspeedPrepareSelectionSource | null;
  initialDraftConfig?: HighspeedPrepareSelectionSource | null;
}): { provider: string; model: string; reasoningLevel?: string } | null {
  const { submissionSelection } = input;
  const fallbacks = [input.projectedConfig, input.draftConfig, input.initialDraftConfig];
  const provider = submissionSelection?.providerId ?? fallbacks.find((c) => c?.provider)?.provider;
  const model = submissionSelection?.modelId ?? fallbacks.find((c) => c?.model)?.model;
  if (!provider || !model) return null;
  const reasoningLevel =
    submissionSelection?.options?.reasoningLevel ??
    fallbacks
      .map((c) => c?.thought || c?.modelSelection?.options?.reasoningLevel)
      .find((value) => !!value);
  return { provider, model, ...(reasoningLevel ? { reasoningLevel } : {}) };
}

export type HighspeedSendContext = {
  override: ReturnType<typeof buildHighspeedRuntimeOverride>;
  acceleratedCard?: HighspeedCardSnapshot;
};

export function buildHighspeedRuntimeOverride(
  result: HighspeedPrepareTurnResult | null | undefined,
): {
  highspeedMeta?: HighspeedMessageMeta;
  modelSelection?: ModelSelection;
  modelExecution?: HighspeedModelExecution;
} {
  if (result?.kind !== "accelerated") return {};
  const highspeedMeta: HighspeedMessageMeta = {
    schemaVersion: 1,
    ...result.card,
  };
  if (!result.execution) return { highspeedMeta };
  return {
    highspeedMeta,
    modelSelection: result.execution.modelSelection,
    modelExecution: {
      selectionScope: "execution",
      requestAuth: result.execution.requestAuth,
      selectionFallback: result.execution.selectionFallback,
    },
  };
}

export async function prepareHighspeedSendContext(
  taskId: string,
  prepareTurn: HighspeedTurnPreparer,
  submissionSelection?: ModelSelection,
): Promise<HighspeedSendContext> {
  const result = await prepareTurn(taskId, submissionSelection);
  return {
    override: buildHighspeedRuntimeOverride(result),
    ...(result?.kind === "accelerated" ? { acceleratedCard: result.card } : {}),
  };
}

export const HIGHSPEED_SEND_WAIT_BUDGET_MS = 1000;

export const HIGHSPEED_REGULAR_TPS_WAIT_BUDGET_MS = 300;

export async function readRegularTpsWithinSendBudget(params: {
  read: () => Promise<number | undefined>;
  
  elapsedMs: number;
  onError?: (error: unknown) => void;
  onTimeout?: (budgetMs: number) => void;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<number | undefined> {
  const budgetMs = Math.max(
    0,
    Math.min(
      HIGHSPEED_REGULAR_TPS_WAIT_BUDGET_MS,
      HIGHSPEED_SEND_WAIT_BUDGET_MS - params.elapsedMs,
    ),
  );
  const reading = (async () => params.read())().then(
    (value) => ({ kind: "value" as const, value }),
    (error: unknown) => {
      params.onError?.(error);
      return { kind: "error" as const };
    },
  );
  if (budgetMs === 0) {
    params.onTimeout?.(0);
    return undefined;
  }
  const wait =
    params.wait ??
    ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const outcome = await Promise.race([
    reading,
    wait(budgetMs).then(() => ({ kind: "timeout" as const })),
  ]);
  if (outcome.kind === "timeout") {
    params.onTimeout?.(budgetMs);
    return undefined;
  }
  return outcome.kind === "value" ? outcome.value : undefined;
}
