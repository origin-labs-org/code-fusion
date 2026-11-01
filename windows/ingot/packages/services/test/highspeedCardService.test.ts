import { describe, expect, it, vi } from "vitest";
import type { HighspeedDrawRequest, HighspeedDrawResponse } from "@origin-ai/cf-shared";
import {
  buildHighspeedCodingPlanAuthHeaders,
  createHighspeedHttpTransport,
  HighspeedCardService,
  type HighspeedInferenceAuth,
  type HighspeedServiceTransport,
} from "../src/highspeed/highspeedCardService.js";
import { createHighspeedMockTransport } from "../src/highspeed/highspeedMockTransport.js";
import { HIGHSPEED_REQUEST_TIMEOUT_MS } from "../src/highspeed/highspeedHttpTransport.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function drainUntil(condition: () => boolean, label: string): Promise<void> {
  for (let turn = 0; turn < 1_000; turn += 1) {
    if (condition()) return;
    await Promise.resolve();
  }
  throw new Error(`condition not reached: ${label}`);
}

const cardResponse = (taskId: string, now: number): HighspeedDrawResponse => ({
  code: 0,
  msg: "success",
  data: {
    card: {
      card_id: "hsc-1",
      task_id: taskId,
      provider: "zai",
      model: "glm-5",
      issued_at: now,
      expires_at: now + 15 * 60_000,
    },
    next_draw_at: now + 60 * 60_000,
  },
});

function createTransport(draw: (request: HighspeedDrawRequest) => Promise<HighspeedDrawResponse>) {
  const calls: HighspeedDrawRequest[] = [];
  const transport: HighspeedServiceTransport = {
    draw: async (request) => {
      calls.push(request);
      return draw(request);
    },
    healthy: async (cardId) => ({
      cardId,
      promptTokens: 0,
      completionTokens: 90,
      durationSeconds: 1,
    }),
  };
  return { calls, transport };
}

describe("HighspeedCardService", () => {
  it("skips draw for an automation turn without disabling the next manual turn", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({ transport, now: () => now });

    const automationResult = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      automationId: "automation-1",
    });

    expect(automationResult).toMatchObject({ kind: "fallback", reason: "automation" });
    expect(calls).toHaveLength(0);

    const manualResult = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(manualResult.kind).toBe("accelerated");
    expect(calls).toHaveLength(1);
  });

  it("only invalidates the matching current card and preserves the draw cooldown", async () => {
    const now = 9_500;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({ transport, now: () => now });
    await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-individual-coding-plan",
      model: "glm-5",
    });
    const before = await service.getSnapshot();

    await expect(service.invalidateCard("older-card")).resolves.toBe(false);
    expect((await service.getSnapshot()).card?.cardId).toBe("hsc-1");
    await expect(service.invalidateCard("hsc-1")).resolves.toBe(true);
    expect(await service.getSnapshot()).toEqual({
      card: null,
      nextDrawAt: before.nextDrawAt,
      drawing: false,
    });

    const next = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-individual-coding-plan",
      model: "glm-5",
    });
    expect(next).toMatchObject({ kind: "fallback", reason: "cooldown" });
    expect(calls).toHaveLength(1);
  });

  it("sends the allowlisted builtin coding-plan id in the draw body instead of the provider id", async () => {
    const now = 10_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({ transport, now: () => now });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:bigmodel-team-coding-plan",
      model: "GLM-5.3",
    });

    expect(result.kind).toBe("accelerated");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      task_id: "task-1",
      provider: "builtin:bigmodel-coding-plan",
      model: "GLM-5.3",
    });
  });

  it("falls back without drawing when the provider has no allowlisted coding-plan id", async () => {
    const now = 10_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({ transport, now: () => now });

    const startPlan = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-start-plan",
      model: "GLM-5.3",
    });
    expect(startPlan).toMatchObject({ kind: "fallback", reason: "unavailable" });

    const custom = await service.prepareTurn({
      taskId: "task-1",
      providerId: "2b05e183-7ae4-46d6-aedb-4c8f750d9811",
      model: "GLM-5.3",
    });
    expect(custom).toMatchObject({ kind: "fallback", reason: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("gates draw on the coding-plan model catalog and keeps covered models accelerated", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    let covered = false;
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveModelCovered: async () => covered,
    });

    const staleModel = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:bigmodel-team-coding-plan",
      model: "GLM-4.6",
    });
    expect(staleModel).toMatchObject({ kind: "fallback", reason: "unavailable" });
    expect(calls).toHaveLength(0);

    covered = true;
    const coveredModel = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:bigmodel-team-coding-plan",
      model: "GLM-5.3",
    });
    expect(coveredModel.kind).toBe("accelerated");
    expect(calls).toHaveLength(1);
  });

  it("treats a failing model catalog check as not covered without drawing", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveModelCovered: async () => {
        throw new Error("model selection view unavailable");
      },
    });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "GLM-5.3",
    });
    expect(result).toMatchObject({ kind: "fallback", reason: "unavailable" });
    expect(calls).toHaveLength(0);
  });

  it("gates draw on Coding Plan support and keeps entitled users accelerated", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    let supported = false;
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveCodingPlanSupported: async () => supported,
    });

    const gatedResult = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(gatedResult).toMatchObject({ kind: "fallback", reason: "no-coding-plan" });
    expect(calls).toHaveLength(0);

    supported = true;
    const entitledResult = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(entitledResult.kind).toBe("accelerated");
    expect(calls).toHaveLength(1);
  });

  it("treats a failing Coding Plan probe as unsupported instead of drawing", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveCodingPlanSupported: async () => {
        throw new Error("credential store unavailable");
      },
    });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(result).toMatchObject({ kind: "fallback", reason: "no-coding-plan" });
    expect(calls).toHaveLength(0);
  });

  it.each(["model catalog", "Coding Plan support"] as const)(
    "falls back as unavailable without drawing when the %s check outlives the send budget",
    async (gate) => {
      const now = 9_000;
      const { calls, transport } = createTransport(async (request) =>
        cardResponse(request.task_id, now),
      );
      const waits: Array<() => void> = [];
      const blocked = deferred<boolean>();
      const service = new HighspeedCardService({
        transport,
        now: () => now,
        wait: async () => new Promise<void>((resolve) => waits.push(resolve)),
        ...(gate === "model catalog"
          ? { resolveModelCovered: () => blocked.promise }
          : { resolveCodingPlanSupported: () => blocked.promise }),
      });
      const params = {
        taskId: "task-1",
        providerId: "account:zai-team-coding-plan",
        model: "glm-5",
        waitBudgetMs: 1,
      };

      const first = service.prepareTurn(params);
      await drainUntil(() => waits.length > 0, "send budget timer registered");
      waits.shift()?.();
      expect(await first).toMatchObject({ kind: "fallback", reason: "unavailable" });
      expect(calls).toHaveLength(0);

      blocked.resolve(true);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(calls).toHaveLength(0);
      expect(await service.getSnapshot()).toEqual({ card: null, nextDrawAt: null, drawing: false });
      expect((await service.prepareTurn(params)).kind).toBe("accelerated");
      expect(calls).toHaveLength(1);
    },
  );

  it("counts the draw wait against the budget already spent on the gates", async () => {
    const now = 9_000;
    const pending = deferred<HighspeedDrawResponse>();
    const { calls, transport } = createTransport(async () => pending.promise);
    const waits: Array<() => void> = [];
    const catalog = deferred<boolean>();
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      wait: async () => new Promise<void>((resolve) => waits.push(resolve)),
      resolveModelCovered: () => catalog.promise,
    });

    const result = service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    });
    await drainUntil(() => waits.length > 0, "send budget timer registered");
    catalog.resolve(true);
    await drainUntil(() => calls.length > 0, "draw started");
    expect(waits).toHaveLength(1);
    waits.shift()?.();
    expect(await result).toMatchObject({ kind: "fallback", reason: "draw-timeout" });
    expect((await service.getSnapshot()).drawing).toBe(true);
  });

  it("falls back as draw-timeout but keeps the card when inference auth outlives the send budget", async () => {
    const now = 9_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const waits: Array<() => void> = [];
    const auth: HighspeedInferenceAuth = {
      cfJwt: "cf-jwt",
      family: "zai",
      codingPlanAuthorization: "coding-plan-jwt",
      targetType: "PERSONAL",
    };
    let pendingAuth: ReturnType<typeof deferred<HighspeedInferenceAuth>> | null = null;
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      wait: async () => new Promise<void>((resolve) => waits.push(resolve)),
      resolveInferenceAuth: async () => (pendingAuth ? pendingAuth.promise : auth),
    });
    const params = {
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    };
    expect((await service.prepareTurn(params)).kind).toBe("accelerated");
    waits.length = 0;

    pendingAuth = deferred<HighspeedInferenceAuth>();
    const blocked = service.prepareTurn(params);
    await drainUntil(() => waits.length > 0, "send budget timer registered");
    waits.shift()?.();
    expect(await blocked).toMatchObject({
      kind: "fallback",
      reason: "draw-timeout",
      card: { cardId: "hsc-1", taskId: "task-1" },
    });
    expect((await service.getSnapshot()).card?.cardId).toBe("hsc-1");

    pendingAuth.resolve(auth);
    pendingAuth = null;
    const next = await service.prepareTurn(params);
    expect(next).toMatchObject({ kind: "accelerated", card: { cardId: "hsc-1" } });
    expect(calls).toHaveLength(1);
  });

  it("keeps mock card semantics but leaves inference on the normal session route", async () => {
    const now = 10_000;
    const { transport } = createTransport(async (request) => cardResponse(request.task_id, now));
    let resolveAuthCalls = 0;
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      inferenceMode: "session-default",
      resolveInferenceAuth: async () => {
        resolveAuthCalls += 1;
        return {
          cfJwt: "must-not-be-used",
          family: "zai",
          codingPlanAuthorization: "must-not-be-used",
          targetType: "PERSONAL",
        };
      },
    });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });

    expect(result).toMatchObject({
      kind: "accelerated",
      card: { taskId: "task-1", model: "glm-5" },
    });
    expect(result).not.toHaveProperty("execution");
    expect(resolveAuthCalls).toBe(0);
  });

  it("accelerates when the current task card arrives inside the wait budget", async () => {
    const now = 10_000;
    const { calls, transport } = createTransport(async (request) =>
      cardResponse(request.task_id, now),
    );
    const service = new HighspeedCardService({ transport, now: () => now });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    });

    expect(result.kind).toBe("accelerated");
    expect(result.card?.taskId).toBe("task-1");
    expect(result.execution?.modelSelection).toEqual({
      providerId: "account:zai-highspeed-card",
      modelId: "glm-5",
    });
    expect(result.execution?.requestAuth.headers["X-Highspeed-Card-ID"]).toBe("hsc-1");
    expect(result.execution?.selectionFallback).toEqual({
      providerId: "account:zai-highspeed-card",
      rules: [
        { reason: "highspeed_card_expired", providerErrorCode: "3402" },
        { reason: "highspeed_request_failed" },
      ],
      target: { providerId: "account:zai-team-coding-plan", modelId: "glm-5" },
    });
    expect(calls).toHaveLength(1);
  });

  it("carries the session reasoning level into the accelerated selection options", async () => {
    const now = 10_000;
    const { transport } = createTransport(async (request) => ({
      code: 0,
      msg: "success",
      data: {
        card: {
          card_id: "hsc-1",
          task_id: request.task_id,
          provider: "bigmodel",
          model: "GLM-5.3",
          issued_at: now,
          expires_at: now + 15 * 60_000,
        },
        next_draw_at: now + 60 * 60_000,
      },
    }));
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveInferenceAuth: async () => ({
        cfJwt: "cf-jwt",
        family: "bigmodel",
        codingPlanAuthorization: "maas-jwt",
        targetType: "PERSONAL",
      }),
    });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:bigmodel-team-coding-plan",
      model: "GLM-5.3",
      reasoningLevel: "enabled",
    });

    expect(result.kind).toBe("accelerated");
    expect(result.execution?.modelSelection).toEqual({
      providerId: "account:bigmodel-highspeed-card",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "enabled" },
    });
    expect(result.execution?.selectionFallback.target).toEqual({
      providerId: "account:bigmodel-team-coding-plan",
      modelId: "GLM-5.3",
      options: { reasoningLevel: "enabled" },
    });
  });

  it("carries the Coding Plan dual-JWT and team identity into the accelerated request auth", async () => {
    const now = 10_000;
    const { transport } = createTransport(async (request) => ({
      code: 0,
      msg: "success",
      data: {
        card: {
          card_id: "hsc-1",
          task_id: request.task_id,
          provider: "bigmodel",
          model: "GLM-5.3",
          issued_at: now,
          expires_at: now + 15 * 60_000,
        },
        next_draw_at: now + 60 * 60_000,
      },
    }));
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      resolveInferenceAuth: async () => ({
        cfJwt: "cf-jwt",
        family: "bigmodel",
        codingPlanAuthorization: "maas-jwt",
        targetType: "TEAM",
        organizationId: "org-1",
        projectId: "project-1",
      }),
    });

    const result = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:bigmodel-team-coding-plan",
      model: "GLM-5.3",
    });

    expect(result.kind).toBe("accelerated");
    expect(result.execution?.requestAuth.apiKey).toBe("cf-jwt");
    expect(result.execution?.requestAuth.headers).toEqual({
      Authorization: "Bearer cf-jwt",
      "X-Bigmodel-Authorization": "Bearer maas-jwt",
      "Bigmodel-Target-Type": "TEAM",
      "Bigmodel-Organization": "org-1",
      "Bigmodel-Project": "project-1",
      "X-Highspeed-Card-ID": "hsc-1",
    });
  });

  it("falls back after one second but keeps the late hit for the next turn", async () => {
    let now = 20_000;
    const pending = deferred<HighspeedDrawResponse>();
    const { calls, transport } = createTransport(async () => pending.promise);
    const waits: Array<() => void> = [];
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      wait: async () => new Promise<void>((resolve) => waits.push(resolve)),
    });

    const firstPromise = service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    });
    await drainUntil(() => calls.length > 0, "draw started");
    waits.shift()?.();
    expect(await firstPromise).toMatchObject({ kind: "fallback", reason: "draw-timeout" });

    pending.resolve(cardResponse("task-1", now));
    await Promise.resolve();
    await Promise.resolve();
    now += 1;

    const second = await service.prepareTurn({
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    });
    expect(second.kind).toBe("accelerated");
    expect(calls).toHaveLength(1);
  });

  it("releases the in-flight draw when the background request fails and draws again next turn", async () => {
    let now = 40_000;
    const pending = deferred<HighspeedDrawResponse>();
    let drawCalls = 0;
    const { calls, transport } = createTransport(async (request) => {
      drawCalls += 1;
      return drawCalls === 1 ? pending.promise : cardResponse(request.task_id, now);
    });
    const waits: Array<() => void> = [];
    const service = new HighspeedCardService({
      transport,
      now: () => now,
      wait: async () => new Promise<void>((resolve) => waits.push(resolve)),
    });
    const params = {
      taskId: "task-1",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
      waitBudgetMs: 1000,
    };

    const first = service.prepareTurn(params);
    await drainUntil(() => calls.length > 0, "draw started");
    waits.shift()?.();
    expect(await first).toMatchObject({ kind: "fallback", reason: "draw-timeout" });
    expect((await service.getSnapshot()).drawing).toBe(true);

    pending.reject(new Error("highspeed draw request timed out after 20000ms"));
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect((await service.getSnapshot()).drawing).toBe(false);

    now += 1;
    const second = await service.prepareTurn(params);
    expect(second.kind).toBe("accelerated");
    expect(calls).toHaveLength(2);
  });

  it("honors next_draw_at and silently falls back for a foreign task card", async () => {
    let now = 30_000;
    const { calls, transport } = createTransport(async () => cardResponse("task-a", now));
    const service = new HighspeedCardService({ transport, now: () => now });

    const taskA = await service.prepareTurn({
      taskId: "task-a",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(taskA.kind).toBe("accelerated");

    const taskB = await service.prepareTurn({
      taskId: "task-b",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(taskB).toMatchObject({ kind: "fallback", reason: "foreign-card" });
    expect(calls).toHaveLength(1);

    now += 16 * 60_000;
    const duringCooldown = await service.prepareTurn({
      taskId: "task-b",
      providerId: "account:zai-team-coding-plan",
      model: "glm-5",
    });
    expect(duringCooldown).toMatchObject({ kind: "fallback", reason: "cooldown" });
    expect(calls).toHaveLength(1);
  });
});

describe("Highspeed mock transport", () => {
  it("uses short draw cooldown and card lifetime for local verification", async () => {
    const now = 50_000;
    const hit = createHighspeedMockTransport({
      scenario: "hit-fast",
      now: () => now,
      delay: async () => undefined,
    });
    const miss = createHighspeedMockTransport({
      scenario: "miss",
      now: () => now,
      delay: async () => undefined,
    });
    const invalidModel = createHighspeedMockTransport({
      scenario: "hit-invalid-model",
      now: () => now,
      delay: async () => undefined,
    });

    const hitResponse = await hit.draw({ task_id: "task-1", provider: "zai", model: "glm-5" });
    const missResponse = await miss.draw({
      task_id: "task-1",
      provider: "zai",
      model: "glm-5",
    });
    const invalidModelResponse = await invalidModel.draw({
      task_id: "task-1",
      provider: "zai",
      model: "glm-5",
    });

    expect(hitResponse.data.card?.expires_at).toBe(now + 5 * 60_000);
    expect(hitResponse.data.next_draw_at).toBe(now + 2 * 60_000);
    expect(missResponse.data.next_draw_at).toBe(now + 2 * 60_000);
    expect(invalidModelResponse.data.card?.model).toBe("E2E-HIGHSPEED-MODEL-NOT-IN-REGISTRY");
  });
});

describe("Highspeed HTTP contract", () => {
  it("builds the shared Coding Plan headers for personal and team plans", () => {
    expect(
      buildHighspeedCodingPlanAuthHeaders({
        cfJwt: "cf-jwt",
        codingPlanAuthorization: "maas-jwt",
        targetType: "PERSONAL",
      }),
    ).toEqual({
      Authorization: "Bearer cf-jwt",
      "X-Bigmodel-Authorization": "Bearer maas-jwt",
      "Bigmodel-Target-Type": "PERSONAL",
    });

    expect(
      buildHighspeedCodingPlanAuthHeaders({
        cfJwt: "Bearer cf-jwt",
        codingPlanAuthorization: "team-maas-jwt",
        targetType: "TEAM",
        organizationId: "org-1",
        projectId: "project-1",
      }),
    ).toEqual({
      Authorization: "Bearer cf-jwt",
      "X-Bigmodel-Authorization": "Bearer team-maas-jwt",
      "Bigmodel-Target-Type": "TEAM",
      "Bigmodel-Organization": "org-1",
      "Bigmodel-Project": "project-1",
    });

    expect(
      buildHighspeedCodingPlanAuthHeaders({
        cfJwt: "cf-jwt",
        codingPlanAuthorization: "Bearer already-prefixed",
        targetType: "PERSONAL",
      }),
    ).toMatchObject({ "X-Bigmodel-Authorization": "Bearer already-prefixed" });
  });

  it("uses Coding Plan headers only for draw and login auth for healthy", async () => {
    const requests: Array<{
      url: string;
      method: string;
      headers: Headers;
      body: unknown;
    }> = [];
    const transport = createHighspeedHttpTransport({
      drawUrl: "https://example.test/api/v1/highspeed/draw",
      healthyBaseUrl: "https://example.test/api/v1/highspeed/",
      drawHeaders: async () => ({
        Authorization: "Bearer cf-jwt",
        "X-Bigmodel-Authorization": "maas-jwt",
        "Bigmodel-Target-Type": "PERSONAL",
      }),
      healthyHeaders: async () => ({ Authorization: "Bearer cf-jwt" }),
      logger: { warn: vi.fn() },
      fetchImpl: async (input, init) => {
        requests.push({
          url: String(input),
          method: init?.method ?? "GET",
          headers: new Headers(init?.headers),
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (String(input).endsWith("/draw")) {
          return Response.json(cardResponse("task-1", 10_000));
        }
        if (String(input).endsWith("/hsc%2F1/healthy")) {
          return Response.json({
            code: 0,
            msg: "success",
            data: {
              card_id: "hsc/1",
              prompt_tokens: 120,
              completion_tokens: 90,
              duration_seconds: 1,
            },
          });
        }
        throw new Error("unexpected request");
      },
    });

    await transport.draw({ task_id: "task-1", provider: "zai", model: "glm-5" });
    const healthy = await transport.healthy("hsc/1");

    expect(requests[0]?.headers.get("X-Bigmodel-Authorization")).toBe("maas-jwt");
    expect(requests[1]).toMatchObject({
      url: "https://example.test/api/v1/highspeed/hsc%2F1/healthy",
      method: "GET",
      body: undefined,
    });
    expect(requests[1]?.headers.get("Authorization")).toBe("Bearer cf-jwt");
    expect(healthy).toEqual({
      cardId: "hsc/1",
      promptTokens: 120,
      completionTokens: 90,
      durationSeconds: 1,
    });
  });

  it("logs draw HTTP failures with safe request diagnostics", async () => {
    const warn = vi.fn();
    let requestHeaders = new Headers();
    const transport = createHighspeedHttpTransport({
      drawUrl: "https://example.test/api/v1/highspeed/draw?credential=secret",
      healthyBaseUrl: "https://example.test/api/v1/highspeed/",
      shareUrl: "https://example.test/api/v1/highspeed/share",
      drawHeaders: async () => ({
        Authorization: "Bearer must-not-be-logged",
        "X-Bigmodel-Authorization": "must-not-be-logged",
      }),
      healthyHeaders: async () => ({ Authorization: "Bearer must-not-be-logged" }),
      shareHeaders: async () => ({ Authorization: "Bearer must-not-be-logged" }),
      logger: { warn },
      fetchImpl: async (_input, init) => {
        requestHeaders = new Headers(init?.headers);
        return Response.json(
          { code: 4290, msg: "too many requests", token: "must-not-be-logged" },
          {
            status: 429,
            statusText: "Too Many Requests",
            headers: {
              "x-request-id": "req-highspeed-draw",
              "x-trace-id": "trace-highspeed-draw",
            },
          },
        );
      },
    });

    await expect(
      transport.draw({ task_id: "task-1", provider: "zai", model: "glm-5" }),
    ).rejects.toThrow("highspeed draw failed: 429");

    expect(requestHeaders.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(warn).toHaveBeenCalledWith(
      undefined,
      "Highspeed 接口 HTTP 请求失败",
      expect.objectContaining({
        operation: "draw",
        method: "POST",
        url: "https://example.test/api/v1/highspeed/draw",
        status: 429,
        statusText: "Too Many Requests",
        responseHeaders: {
          "x-request-id": "req-highspeed-draw",
          "x-trace-id": "trace-highspeed-draw",
        },
        response: { code: 4290, message: "too many requests", fields: ["code", "msg", "token"] },
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("must-not-be-logged");
  });

  it("logs healthy HTTP failures without logging authorization", async () => {
    const warn = vi.fn();
    const transport = createHighspeedHttpTransport({
      drawUrl: "https://example.test/api/v1/highspeed/draw",
      healthyBaseUrl: "https://example.test/api/v1/highspeed/",
      shareUrl: "https://example.test/api/v1/highspeed/share",
      drawHeaders: async () => ({ Authorization: "Bearer draw-secret" }),
      healthyHeaders: async () => ({ Authorization: "Bearer healthy-secret" }),
      shareHeaders: async () => ({ Authorization: "Bearer share-secret" }),
      logger: { warn },
      fetchImpl: async () =>
        Response.json(
          { code: 3402, msg: "highspeed card is invalid" },
          { status: 404, statusText: "Not Found" },
        ),
    });

    await expect(transport.healthy("hsc/secret")).rejects.toThrow("highspeed healthy failed: 404");

    expect(warn).toHaveBeenCalledWith(
      undefined,
      "Highspeed 接口 HTTP 请求失败",
      expect.objectContaining({
        operation: "healthy",
        method: "GET",
        url: "https://example.test/api/v1/highspeed/hsc%2Fsecret/healthy",
        status: 404,
        statusText: "Not Found",
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("healthy-secret");
  });

  it("rejects and logs Highspeed business envelope failures with response request id", async () => {
    const warn = vi.fn();
    const transport = createHighspeedHttpTransport({
      drawUrl: "https://example.test/api/v1/highspeed/draw",
      healthyBaseUrl: "https://example.test/api/v1/highspeed/",
      shareUrl: "https://example.test/api/v1/highspeed/share",
      drawHeaders: async () => ({}),
      healthyHeaders: async () => ({}),
      shareHeaders: async () => ({}),
      logger: { warn },
      fetchImpl: async () =>
        Response.json(
          { ...cardResponse("task-1", 10_000), code: 2007, msg: "dependency failed" },
          { headers: { "x-request-id": "req-highspeed-business" } },
        ),
    });

    await expect(
      transport.draw({ task_id: "task-1", provider: "zai", model: "glm-5" }),
    ).rejects.toThrow("highspeed draw failed: business code 2007");

    expect(warn).toHaveBeenCalledWith(
      undefined,
      "Highspeed 接口业务失败",
      expect.objectContaining({
        operation: "draw",
        status: 200,
        responseHeaders: { "x-request-id": "req-highspeed-business" },
        response: expect.objectContaining({ code: 2007, message: "dependency failed" }),
      }),
    );
  });

  it("aborts a request that never returns so the in-flight draw can be released", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      let observedSignal: AbortSignal | null | undefined;
      const transport = createHighspeedHttpTransport({
        drawUrl: "https://example.test/api/v1/highspeed/draw",
        healthyBaseUrl: "https://example.test/api/v1/highspeed/",
        drawHeaders: async () => ({}),
        healthyHeaders: async () => ({}),
        logger: { warn },
        fetchImpl: (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            observedSignal = init?.signal;
            init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
              once: true,
            });
          }),
      });

      const draw = transport.draw({ task_id: "task-1", provider: "zai", model: "glm-5" });
      const settled = draw.then(
        () => "resolved",
        () => "rejected",
      );
      expect(HIGHSPEED_REQUEST_TIMEOUT_MS).toBeGreaterThan(1000);
      await vi.advanceTimersByTimeAsync(HIGHSPEED_REQUEST_TIMEOUT_MS - 1);
      expect(observedSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(observedSignal?.aborted).toBe(true);
      await expect(draw).rejects.toThrow(/timed out after 20000ms/);
      expect(await settled).toBe("rejected");
      expect(warn).toHaveBeenCalledWith(
        undefined,
        "Highspeed 接口网络请求失败",
        expect.objectContaining({ operation: "draw", method: "POST" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
