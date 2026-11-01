import { describe, expect, it } from "vitest";
import {
  HookEventName,
  SessionEventType,
  createRootTraceContext,
  createSessionId,
  createToolCallId,
  createTurnId,
  type CollaborationMode,
  type DynamicWorkflowRunPort,
  type PermissionBrokerPort,
  type PermissionBrokerRequest,
  type PermissionRequestedPayload,
  type SessionEvent,
  type ToolExecutionResult,
} from "@origin-ai/cf-contracts";
import { PermissionService, defaultPermissionConfig } from "../src/permission/service.js";
import { createToolExecutor } from "../src/tool/executor.js";
import { resumeWorkflowRunToolEntry } from "../src/tool/handlers/resume-workflow-run.js";
import { createToolRegistry } from "../src/tool/registry.js";
import type { HookRunner } from "../src/hooks/index.js";

function stubResumePort(runId: string): DynamicWorkflowRunPort {
  const unreachable = (name: string) => () => {
    throw new Error(`stubResumePort.${name} 不应被 ResumeWorkflowRun Permissions路径触及`);
  };
  return {
    async resume() {
      return { ok: true, runId };
    },
    submit: unreachable("submit"),
    waitForTask: unreachable("waitForTask"),
    cancel: unreachable("cancel"),
    listEvents: unreachable("listEvents"),
  } as unknown as DynamicWorkflowRunPort;
}

interface RunOptions {
  broker?: PermissionBrokerPort;
  hookRunner?: HookRunner;
  mode?: CollaborationMode;
  name: string;
  runId: string;
}

interface RunOutcome {
  brokerRequests: PermissionBrokerRequest[];
  events: SessionEvent[];
  permissionRequested: PermissionRequestedPayload[];
  result: ToolExecutionResult;
}

async function run(options: RunOptions): Promise<RunOutcome> {
  const sessionId = createSessionId(options.name);
  const turnId = createTurnId(options.name);
  const traceContext = createRootTraceContext({ sessionId, turnId });
  const events: SessionEvent[] = [];
  const brokerRequests: PermissionBrokerRequest[] = [];
  const permissionBroker: PermissionBrokerPort = {
    async requestPermission(request, requestOptions) {
      brokerRequests.push(request);
      return (
        options.broker?.requestPermission(request, requestOptions) ?? { decision: "allow" as const }
      );
    },
  };

  const registry = createToolRegistry();
  registry.register(resumeWorkflowRunToolEntry);
  const executor = createToolExecutor({
    dynamicWorkflowRunPort: stubResumePort(options.runId),
    emitEvent: async (event) => {
      events.push(event);
    },
    ...(options.hookRunner ? { hookRunner: options.hookRunner } : {}),
    mode: options.mode ?? "build",
    permissionBroker,
    permissionService: new PermissionService(defaultPermissionConfig),
    registry,
    sessionId,
    turnId,
    traceContext,
  });

  const result = await executor.execute(
    {
      id: createToolCallId(options.name),
      input: { run_id: options.runId },
      name: "ResumeWorkflowRun",
    },
    { traceContext },
  );

  return {
    brokerRequests,
    events,
    permissionRequested: events
      .filter((event) => event.type === SessionEventType.PermissionRequested)
      .map((event) => event.payload as PermissionRequestedPayload),
    result,
  };
}

describe("ResumeWorkflowRun prompt-less execution", () => {
  for (const mode of ["build", "yolo"] as const) {
    it(`${mode} Mode免确认直行：不发Permission request、不触 broker`, async () => {
      const outcome = await run({ mode, name: `resume-run-${mode}`, runId: "dwfrun-gate" });

      expect(outcome.permissionRequested).toHaveLength(0);
      expect(outcome.brokerRequests).toHaveLength(0);
      expect(outcome.result.success).toBe(true);
      expect(outcome.result.output).toMatchObject({
        ok: true,
        runId: "dwfrun-gate",
        status: "backgrounded",
        backgroundTaskId: "dwfrun-gate",
      });
    });
  }

  it("plan 模式按 read-only 契约直接拒绝（不是确认窗）", async () => {
    const outcome = await run({ mode: "plan", name: "resume-run-plan", runId: "dwfrun-plan" });

    expect(outcome.permissionRequested).toHaveLength(0);
    expect(outcome.brokerRequests).toHaveLength(0);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error?.type).toBe("permission_denied");
    expect(outcome.result.error?.message).toContain(
      "Plan mode only allows read-only, non-destructive tools",
    );
    expect(outcome.events.some((event) => event.type === SessionEventType.ToolCallResult)).toBe(
      false,
    );
  });

  it("PreToolUse hook 的 deny 仍能拦截（拦截面不随免确认消失）", async () => {
    const hookRunner: HookRunner = {
      async run(input) {
        return input.hookEventName === HookEventName.PreToolUse
          ? { additionalContexts: [], permissionBehavior: "deny" }
          : { additionalContexts: [] };
      },
    };

    const outcome = await run({
      hookRunner,
      mode: "yolo",
      name: "resume-run-pretooluse-deny",
      runId: "dwfrun-hook-deny",
    });

    expect(outcome.permissionRequested).toHaveLength(0);
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error?.type).toBe("permission_denied");
    expect(outcome.result.error?.message).toContain("Blocked by PreToolUse hook");
    expect(outcome.events.some((event) => event.type === SessionEventType.ToolCallResult)).toBe(
      false,
    );
  });
});
