//
import { describe, expect, it, vi } from "vitest";
import { createSessionId, type DynamicWorkflowRunProgressPayload, type SessionId } from "@origin-ai/cf-contracts";
import type { AgentRuntime } from "@origin-ai/cf-core";
import { createDynamicWorkflowRunProgressSink } from "../src/app/dynamic-workflow-run-progress-sink.js";

const OWN_SESSION = createSessionId("progress-sink-owner");

const progress: DynamicWorkflowRunProgressPayload = {
  runId: "dwfrun-1",
  sequence: 4,
  eventType: "node-dispatched",
  payload: { instance: { siteId: "ask#1", ordinal: 1 } },
};

function makeSink(
  options: {
    record?: (input: DynamicWorkflowRunProgressPayload) => Promise<void>;
    getRuntime?: () => AgentRuntime;
    sessionId?: SessionId;
  } = {},
) {
  const appended: DynamicWorkflowRunProgressPayload[] = [];
  const warnings: { message: string; context: Record<string, unknown> }[] = [];
  const record =
    options.record ??
    (async (input: DynamicWorkflowRunProgressPayload) => {
      appended.push(input);
    });
  const runtime = { recordDynamicWorkflowRunProgress: record } as unknown as AgentRuntime;
  const sink = createDynamicWorkflowRunProgressSink({
    getRuntime: options.getRuntime ?? (() => runtime),
    logger: {
      warn: (message: string, context?: Record<string, unknown>) => {
        warnings.push({ message, context: context ?? {} });
      },
    } as never,
    sessionId: options.sessionId ?? OWN_SESSION,
  });
  return { appended, sink, warnings };
}

describe("dwf run 进度汇：正路径", () => {
  it("Append payload as-is to this app\'s runtime", async () => {
    const { appended, sink, warnings } = makeSink();
    sink(progress, { parentSessionId: OWN_SESSION });
    await Promise.resolve();

    expect(appended).toEqual([progress]);
    expect(warnings).toEqual([]);
  });

  it("Append even if routing is absent: this app\'s port can only be reached by this session", async () => {
    const { appended, sink, warnings } = makeSink();
    sink(progress);
    await Promise.resolve();

    expect(appended).toEqual([progress]);
    expect(warnings).toEqual([]);
  });
});

describe("dwf run 进度汇：身份闸门", () => {
  it("parentSessionId 不是本会话时**不追加**，只记日志", async () => {
    const { appended, sink, warnings } = makeSink();
    sink(progress, { parentSessionId: createSessionId("someone-elses-session") });
    await Promise.resolve();

    expect(appended).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.context).toMatchObject({
      event: "dynamic_workflow.run_progress.session_mismatch",
      expectedSessionId: OWN_SESSION,
      runId: "dwfrun-1",
    });
  });
});

describe("dwf run 进度汇：降级路径（run 绝不能被观察面打挂）", () => {
  it("runtime 尚未构造（getRuntime 同步抛错）→ 记日志的 no-op", () => {
    const { appended, sink, warnings } = makeSink({
      getRuntime: () => {
        throw new Error("CodeFusion runtime is not initialized yet.");
      },
    });

    expect(() => sink(progress)).not.toThrow();
    expect(appended).toEqual([]);
    expect(warnings[0]?.context).toMatchObject({ reason: "runtime_unavailable" });
  });

  it("append 被拒（会话已关闭 / 存储已 dispose）→ 记日志的 no-op，且不产生未处理拒绝", async () => {
    const rejections: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      rejections.push(error);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const { appended, sink, warnings } = makeSink({
        record: async () => {
          throw new Error("session store is closed");
        },
      });

      expect(() => sink(progress)).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));

      expect(appended).toEqual([]);
      expect(warnings[0]?.context).toMatchObject({
        errorMessage: "session store is closed",
        reason: "append_rejected",
      });
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("record 同步抛错（而非返回 rejected promise）同样被吞", () => {
    const { appended, sink, warnings } = makeSink({
      record: (() => {
        throw new Error("synchronous boom");
      }) as never,
    });

    expect(() => sink(progress)).not.toThrow();
    expect(appended).toEqual([]);
    expect(warnings).toHaveLength(1);
  });

  it("一次失败不影响后续事件：终态事件仍能落地", async () => {
    let calls = 0;
    const landed: string[] = [];
    const { sink } = makeSink({
      record: async (input) => {
        calls += 1;
        if (calls === 1) throw new Error("transient");
        landed.push(input.eventType);
      },
    });

    sink(progress);
    sink({ ...progress, sequence: 5, eventType: "run-settled", payload: { status: "completed" } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(landed).toEqual(["run-settled"]);
  });
});

describe("dwf run 进度汇：无 logger 时也不崩", () => {
  it("logger 缺席时降级路径静默吞掉", () => {
    const sink = createDynamicWorkflowRunProgressSink({
      getRuntime: () => {
        throw new Error("no runtime");
      },
      sessionId: OWN_SESSION,
    });
    expect(() => sink(progress)).not.toThrow();
  });
});
