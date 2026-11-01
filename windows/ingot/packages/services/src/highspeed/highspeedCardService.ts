import {
  resolveHighspeedProviderId,
  resolveHighspeedDrawProviderId,
  highspeedDrawResponseSchema,
  HIGHSPEED_CARD_EXPIRED_PROVIDER_ERROR_CODE,
  type HighspeedCardApi,
  type HighspeedCardUsage,
  type HighspeedCardSnapshot,
  type HighspeedDrawRequest,
  type HighspeedDrawResponse,
  type HighspeedPrepareFallbackReason,
  type HighspeedPrepareTurnParams,
  type HighspeedPrepareTurnResult,
  type HighspeedServiceSnapshot,
  type HighspeedTurnExecution,
  type ModelSelection,
} from "@origin-ai/cf-shared";
import type { IHighspeedCardService } from "./highspeedCard.js";

export { createHighspeedHttpTransport } from "./highspeedHttpTransport.js";

export interface HighspeedServiceTransport {
  draw(request: HighspeedDrawRequest): Promise<HighspeedDrawResponse>;
  healthy(cardId: string): Promise<HighspeedCardUsage>;
}

export interface HighspeedInferenceAuth {
  cfJwt: string;
  family: "zai" | "bigmodel";
  codingPlanAuthorization: string;
  targetType: "PERSONAL" | "TEAM";
  organizationId?: string;
  projectId?: string;
}

export interface HighspeedCardServiceOptions {
  transport: HighspeedServiceTransport;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  
  resolveInferenceAuth?: () => Promise<HighspeedInferenceAuth>;
  
  inferenceMode?: "highspeed" | "session-default";
  
  resolveCodingPlanSupported?: () => Promise<boolean>;
  
  resolveModelCovered?: (providerId: string, modelId: string) => Promise<boolean>;
}

const DEFAULT_WAIT_BUDGET_MS = 1000;

type SendBudgetOutcome<T> = { kind: "settled"; value: T } | { kind: "timeout" };

type SendBudget = <T>(task: Promise<T>) => Promise<SendBudgetOutcome<T>>;

export function buildHighspeedCodingPlanAuthHeaders(params: {
  cfJwt: string;
  codingPlanAuthorization: string;
  targetType: "PERSONAL" | "TEAM";
  organizationId?: string;
  projectId?: string;
}): Record<string, string> {
  const cfJwt = params.cfJwt.trim();
  const codingPlanAuthorization = params.codingPlanAuthorization.trim();
  if (!cfJwt) throw new Error("highspeed request requires cf jwt");
  if (!codingPlanAuthorization) throw new Error("highspeed request requires Coding Plan jwt");
  if (params.targetType === "TEAM" && (!params.organizationId || !params.projectId)) {
    throw new Error("highspeed team request requires organization and project");
  }
  return {
    Authorization: /^Bearer\s/i.test(cfJwt) ? cfJwt : `Bearer ${cfJwt}`,
    "X-Bigmodel-Authorization": /^Bearer\s/i.test(codingPlanAuthorization)
      ? codingPlanAuthorization
      : `Bearer ${codingPlanAuthorization}`,
    "Bigmodel-Target-Type": params.targetType,
    ...(params.targetType === "TEAM"
      ? {
          "Bigmodel-Organization": params.organizationId!,
          "Bigmodel-Project": params.projectId!,
        }
      : {}),
  };
}

function toSnapshot(card: HighspeedCardApi): HighspeedCardSnapshot {
  return {
    cardId: card.card_id,
    taskId: card.task_id,
    provider: card.provider,
    model: card.model,
    issuedAt: card.issued_at,
    expiresAt: card.expires_at,
  };
}

export function buildHighspeedTurnExecution(params: {
  card: HighspeedCardSnapshot;
  auth: HighspeedInferenceAuth;
  
  sessionSelection: ModelSelection;
}): HighspeedTurnExecution {
  const providerId = resolveHighspeedProviderId(params.auth.family);
  const reasoningLevel = params.sessionSelection.options?.reasoningLevel;
  return {
    modelSelection: {
      providerId,
      modelId: params.card.model,
      ...(reasoningLevel ? { options: { reasoningLevel } } : {}),
    },
    requestAuth: {
      apiKey: params.auth.cfJwt,
      headers: {
        ...buildHighspeedCodingPlanAuthHeaders({
          cfJwt: params.auth.cfJwt,
          codingPlanAuthorization: params.auth.codingPlanAuthorization,
          targetType: params.auth.targetType,
          ...(params.auth.organizationId ? { organizationId: params.auth.organizationId } : {}),
          ...(params.auth.projectId ? { projectId: params.auth.projectId } : {}),
        }),
        "X-Highspeed-Card-ID": params.card.cardId,
      },
    },
    selectionFallback: {
      providerId,
      rules: [
        {
          reason: "highspeed_card_expired",
          providerErrorCode: HIGHSPEED_CARD_EXPIRED_PROVIDER_ERROR_CODE,
        },
        { reason: "highspeed_request_failed" },
      ],
      target: structuredClone(params.sessionSelection),
    },
  };
}

export class HighspeedCardService implements IHighspeedCardService {
  private readonly transport: HighspeedServiceTransport;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly resolveInferenceAuth: () => Promise<HighspeedInferenceAuth>;
  private readonly inferenceMode: "highspeed" | "session-default";
  private readonly resolveCodingPlanSupported: () => Promise<boolean>;
  private readonly resolveModelCovered: (providerId: string, modelId: string) => Promise<boolean>;
  private card: HighspeedCardSnapshot | null = null;
  private nextDrawAt: number | null = null;
  private inFlightDraw: Promise<HighspeedDrawResponse> | null = null;

  constructor(options: HighspeedCardServiceOptions) {
    this.transport = options.transport;
    this.now = options.now ?? Date.now;
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.resolveInferenceAuth =
      options.resolveInferenceAuth ??
      (async () => ({
        cfJwt: "mock-cf-jwt",
        family: "zai",
        codingPlanAuthorization: "mock-coding-plan-jwt",
        targetType: "PERSONAL",
      }));
    this.inferenceMode = options.inferenceMode ?? "highspeed";
    this.resolveCodingPlanSupported = options.resolveCodingPlanSupported ?? (async () => true);
    this.resolveModelCovered = options.resolveModelCovered ?? (async () => true);
  }

  async prepareTurn(params: HighspeedPrepareTurnParams): Promise<HighspeedPrepareTurnResult> {
    if (params.automationId?.trim()) {
      return { kind: "fallback", reason: "automation", nextDrawAt: this.nextDrawAt };
    }

    const now = this.now();
    this.expireCard(now);
    const withinBudget = this.createSendBudget(now, params.waitBudgetMs ?? DEFAULT_WAIT_BUDGET_MS);

    if (this.card) {
      return this.prepareWithCard(this.card, params, withinBudget);
    }
    if (this.nextDrawAt !== null && now < this.nextDrawAt) {
      return { kind: "fallback", reason: "cooldown", nextDrawAt: this.nextDrawAt };
    }

    // （builtin:zai-coding-plan / builtin:bigmodel-coding-plan）；Start/Off-Peak/API Key/
    const drawProviderId = resolveHighspeedDrawProviderId(params.providerId);
    if (!drawProviderId) {
      return { kind: "fallback", reason: "unavailable", nextDrawAt: this.nextDrawAt };
    }

    if (!this.inFlightDraw) {
      const gate = await withinBudget(this.checkDrawGates(params.providerId, params.model));
      if (gate.kind === "timeout") {
        return { kind: "fallback", reason: "unavailable", nextDrawAt: this.nextDrawAt };
      }
      if (gate.value) {
        return { kind: "fallback", reason: gate.value, nextDrawAt: this.nextDrawAt };
      }
    }

    const draw = this.inFlightDraw ?? this.startDraw(params, drawProviderId);
    const outcome = await withinBudget(draw);
    if (outcome.kind === "timeout") {
      return { kind: "fallback", reason: "draw-timeout", nextDrawAt: this.nextDrawAt };
    }

    this.applyDrawResponse(outcome.value);
    if (!this.card) {
      return { kind: "fallback", reason: "draw-miss", nextDrawAt: this.nextDrawAt };
    }
    return this.prepareWithCard(this.card, params, withinBudget);
  }

  async getSnapshot(): Promise<HighspeedServiceSnapshot> {
    this.expireCard(this.now());
    return {
      card: this.card,
      nextDrawAt: this.nextDrawAt,
      drawing: this.inFlightDraw !== null,
    };
  }

  async invalidateCard(cardId: string): Promise<boolean> {
    this.expireCard(this.now());
    if (this.card?.cardId !== cardId) return false;
    this.card = null;
    return true;
  }

  healthy(cardId: string): Promise<HighspeedCardUsage> {
    return this.transport.healthy(cardId);
  }

  
  private async checkDrawGates(
    providerId: string,
    modelId: string,
  ): Promise<Extract<HighspeedPrepareFallbackReason, "unavailable" | "no-coding-plan"> | null> {
    if (!(await this.isModelCovered(providerId, modelId))) return "unavailable";
    if (!(await this.isCodingPlanSupported())) return "no-coding-plan";
    return null;
  }

  
  private createSendBudget(startedAt: number, budgetMs: number): SendBudget {
    const deadline = startedAt + budgetMs;
    let expired: Promise<{ kind: "timeout" }> | null = null;
    return <T>(task: Promise<T>) => {
      expired ??= this.wait(Math.max(0, deadline - this.now())).then(() => ({
        kind: "timeout" as const,
      }));
      return Promise.race([task.then((value) => ({ kind: "settled" as const, value })), expired]);
    };
  }

  private async isCodingPlanSupported(): Promise<boolean> {
    try {
      return await this.resolveCodingPlanSupported();
    } catch {
      return false;
    }
  }

  private async isModelCovered(providerId: string, modelId: string): Promise<boolean> {
    try {
      return await this.resolveModelCovered(providerId, modelId);
    } catch {
      return false;
    }
  }

  private startDraw(
    params: HighspeedPrepareTurnParams,
    drawProviderId: string,
  ): Promise<HighspeedDrawResponse> {
    const draw = this.transport
      .draw({ task_id: params.taskId, provider: drawProviderId, model: params.model })
      .then((response) => {
        this.applyDrawResponse(response);
        return response;
      })
      .finally(() => {
        if (this.inFlightDraw === draw) this.inFlightDraw = null;
      });
    this.inFlightDraw = draw;
    return draw;
  }

  private applyDrawResponse(response: HighspeedDrawResponse): void {
    const parsed = highspeedDrawResponseSchema.parse(response);
    this.nextDrawAt = parsed.data.next_draw_at;
    this.card = parsed.data.card ? toSnapshot(parsed.data.card) : null;
    this.expireCard(this.now());
  }

  private expireCard(now: number): void {
    if (this.card && this.card.expiresAt <= now) this.card = null;
  }

  private async prepareWithCard(
    card: HighspeedCardSnapshot,
    params: Pick<HighspeedPrepareTurnParams, "taskId" | "providerId" | "model" | "reasoningLevel">,
    withinBudget: SendBudget,
  ): Promise<HighspeedPrepareTurnResult> {
    if (card.taskId !== params.taskId) {
      return { kind: "fallback", reason: "foreign-card", card, nextDrawAt: this.nextDrawAt };
    }
    if (this.inferenceMode === "session-default") {
      return {
        kind: "accelerated",
        card,
        nextDrawAt: this.nextDrawAt ?? card.expiresAt,
      };
    }
    const auth = await withinBudget(this.resolveInferenceAuth());
    if (auth.kind === "timeout") {
      return { kind: "fallback", reason: "draw-timeout", card, nextDrawAt: this.nextDrawAt };
    }
    const sessionSelection: ModelSelection = {
      providerId: params.providerId,
      modelId: params.model,
      ...(params.reasoningLevel ? { options: { reasoningLevel: params.reasoningLevel } } : {}),
    };
    return {
      kind: "accelerated",
      card,
      nextDrawAt: this.nextDrawAt ?? card.expiresAt,
      execution: buildHighspeedTurnExecution({ card, auth: auth.value, sessionSelection }),
    };
  }
}
