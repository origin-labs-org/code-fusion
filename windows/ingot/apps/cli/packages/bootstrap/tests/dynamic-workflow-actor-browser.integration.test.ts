// ============================================================
// ============================================================
//
//

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqliteSessionStore } from "@origin-ai/cf-adapters/storage";
import { ESCALATE_TOOL_NAME, type ModelRequest, type ModelResult } from "@origin-ai/cf-contracts";
import { saveSavedWorkflow } from "@origin-ai/cf-core";
import { createProtocolBrowserControlBroker } from "../src/cf-protocol/browser-control-broker.js";
import type { CfProtocolAgentServerContext } from "../src/cf-protocol/server-types.js";
import { createRegistryBackedTestApp as createCfApp } from "./helpers/registry-backed-test-app.js";

const WORKFLOW_NAME = "browse";
const ACTOR_SESSION_PREFIX = "sess_dwf-";
const IAB_BROWSER_ID = "iab:test";
const IAB_GENERATION = 7;
const SETTLE_TIMEOUT_MS = 20_000;

interface DesktopCall {
  method: string;
  sessionId: string;
  workspaceKey: string;
  workspacePath: string;
  command?: Record<string, unknown>;
}

function textResult(text: string): ModelResult {
  return {
    finishReason: "stop",
    text,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  } as unknown as ModelResult;
}

function isActorRequest(request: ModelRequest): boolean {
  return (request.tools ?? []).some((tool) => tool.name === ESCALATE_TOOL_NAME);
}

describe("dwf 子代理的 Browser Use（真 app 装配）", () => {
  let root: string;
  let sessionStore: Awaited<ReturnType<typeof createSqliteSessionStore>>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-dwf-actor-browser-"));
    sessionStore = await createSqliteSessionStore({ dbPath: ":memory:" });
  });

  afterEach(async () => {
    sessionStore.close();
    await rm(root, { force: true, recursive: true });
  });

  it("Actor\'s browser requests reach desktop with its own sessionId and parent session\'s workspace; tabs close when run ends", async () => {
    const desktopCalls: DesktopCall[] = [];
    const requestClient = vi.fn(async (method: string, params: unknown) => {
      const p = params as Omit<DesktopCall, "method">;
      desktopCalls.push({
        method,
        sessionId: p.sessionId,
        workspaceKey: p.workspaceKey,
        workspacePath: p.workspacePath,
        ...(p.command === undefined ? {} : { command: p.command }),
      });
      return method.endsWith("browserList") ? { browsers: [] } : { ok: true, elapsedMs: 0 };
    });
    const sessions = new Map<string, unknown>();
    const context = {
      requestClient,
      sessions,
    } as unknown as CfProtocolAgentServerContext;
    const appPort = createProtocolBrowserControlBroker(context);
    const nodeReplPort = createProtocolBrowserControlBroker(context);

    let actorSessionId: string | undefined;
    let actorBrowserResult: unknown;
    saveSavedWorkflow({
      cwd: root,
      name: WORKFLOW_NAME,
      scope: "project",
      script: 'await agent("browser-user").ask("Open example.com in the browser.");\nreturn 1;',
      meta: { description: "open a page" },
    });

    const app = await createCfApp({
      env: {},
      browserControlPort: appPort,
      modelExecutor: {
        async generateText(request) {
          if (!isActorRequest(request)) return textResult("ok");
          if (actorSessionId === undefined) {
            const listed = await sessionStore.listSessions();
            actorSessionId = listed.find((session) =>
              String(session.id).startsWith(ACTOR_SESSION_PREFIX),
            )?.id;
            actorBrowserResult = await nodeReplPort.execute({
              browserId: IAB_BROWSER_ID,
              browserGeneration: IAB_GENERATION,
              sessionId: String(actorSessionId),
              command: { method: "newTab" },
            });
          }
          return textResult("opened example.com");
        },
      },
      runtimeConfig: { workingDirectory: root, dynamicWorkflowEnabled: true },
      sessionStore,
      skipUserConfig: true,
    });
    try {
      sessions.set(app.sessionId, {
        deliveryKind: "desktop-continuous",
        workspace: { workspaceKey: root, workspacePath: root },
      });

      const started = await app.startSavedWorkflow?.({ name: WORKFLOW_NAME, scope: "project" });
      expect(started).toMatchObject({ ok: true });

      await vi.waitFor(
        () => {
          expect(desktopCalls.some((call) => call.command?.method === "closeSession")).toBe(true);
        },
        { timeout: SETTLE_TIMEOUT_MS, interval: 50 },
      );

      expect(actorSessionId).toMatch(new RegExp(`^${ACTOR_SESSION_PREFIX}`));
      expect(actorBrowserResult).toMatchObject({ ok: true });
      expect(
        desktopCalls.map((call) => ({ method: call.command?.method, sessionId: call.sessionId })),
      ).toEqual([
        { method: "newTab", sessionId: actorSessionId },
        { method: "turnEnded", sessionId: actorSessionId },
        { method: "closeSession", sessionId: actorSessionId },
      ]);
      expect(desktopCalls.every((call) => call.workspaceKey === root)).toBe(true);
      expect(desktopCalls.every((call) => call.workspacePath === root)).toBe(true);
      expect(desktopCalls.at(-1)?.command).toEqual({ method: "closeSession", closeTabs: true });
      await expect(nodeReplPort.list({ sessionId: String(actorSessionId) })).rejects.toThrow(
        `Session is not active: ${actorSessionId}`,
      );
    } finally {
      await app.close();
    }
  }, 30_000);
});
