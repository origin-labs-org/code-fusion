//
import { describe, expect, it, vi } from "vitest";
import type {
  V4ConversationWorkflowRunEventsResult,
  V4ConversationWorkflowRunsResult,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { ReplaceableConversationTransport } from "../src/v4/replaceableConversationTransport.js";
import type { ConversationTransport } from "../src/v4/transport.js";

function stubTransport(result: V4ConversationWorkflowRunEventsResult) {
  const workflowRunEvents = vi.fn(async () => result);
  return {
    workflowRunEvents,
    transport: { workflowRunEvents } as unknown as ConversationTransport,
  };
}

const firstPage: V4ConversationWorkflowRunEventsResult = {
  events: [{ sequence: 7, type: "run.started", payload: { runId: "dwfrun-1" } }],
  hasMore: true,
};
const secondPage: V4ConversationWorkflowRunEventsResult = { events: [], hasMore: false };

describe("ReplaceableConversationTransport workflowRunEvents", () => {
  it("Forward as-is to current transport without modifying any params fields", async () => {
    const first = stubTransport(firstPage);
    const replaceable = new ReplaceableConversationTransport(first.transport);
    const params = { sessionId: "session-1", runId: "dwfrun-1", afterSequence: 6, limit: 50 };

    await expect(replaceable.workflowRunEvents(params)).resolves.toEqual(firstPage);
    expect(first.workflowRunEvents).toHaveBeenCalledWith(params);
  });

  it("Forward to new transport after replace; old one is no longer called", async () => {
    const first = stubTransport(firstPage);
    const second = stubTransport(secondPage);
    const replaceable = new ReplaceableConversationTransport(first.transport);

    replaceable.replace(second.transport);
    const params = { sessionId: "session-1", runId: "dwfrun-1" };

    await expect(replaceable.workflowRunEvents(params)).resolves.toEqual(secondPage);
    expect(second.workflowRunEvents).toHaveBeenCalledWith(params);
    expect(first.workflowRunEvents).not.toHaveBeenCalled();
  });
});

function stubRunsTransport(result: V4ConversationWorkflowRunsResult) {
  const workflowRuns = vi.fn(async () => result);
  return {
    workflowRuns,
    transport: { workflowRuns } as unknown as ConversationTransport,
  };
}

const runsPage: V4ConversationWorkflowRunsResult = {
  runs: [
    {
      runId: "dwfrun-1",
      toolCallId: "call-1",
      status: "cancelled",
      resumable: true,
    },
  ],
};
const emptyRuns: V4ConversationWorkflowRunsResult = { runs: [] };

describe("ReplaceableConversationTransport workflowRuns", () => {
  it("Forward as-is to current transport", async () => {
    const first = stubRunsTransport(runsPage);
    const replaceable = new ReplaceableConversationTransport(first.transport);
    const params = { sessionId: "session-1", limit: 8 };

    await expect(replaceable.workflowRuns(params)).resolves.toEqual(runsPage);
    expect(first.workflowRuns).toHaveBeenCalledWith(params);
  });

  it("Forward to new transport after replace; old one is no longer called", async () => {
    const first = stubRunsTransport(runsPage);
    const second = stubRunsTransport(emptyRuns);
    const replaceable = new ReplaceableConversationTransport(first.transport);

    replaceable.replace(second.transport);
    const params = { sessionId: "session-1" };

    await expect(replaceable.workflowRuns(params)).resolves.toEqual(emptyRuns);
    expect(second.workflowRuns).toHaveBeenCalledWith(params);
    expect(first.workflowRuns).not.toHaveBeenCalled();
  });
});

//
describe("ReplaceableConversationTransport 用户面产物与脚本 transcript 的转发", () => {
  
  const cases = [
    {
      method: "workflowRunArtifacts" as const,
      params: { sessionId: "session-1", runId: "dwfrun-1" },
      first: { artifacts: [] },
      second: {
        artifacts: [
          {
            id: "book",
            kind: "file" as const,
            version: 1,
            versions: [{ version: 1, publishedAt: 1 }],
            itemCount: 0,
          },
        ],
      },
    },
    {
      method: "workflowRunArtifactData" as const,
      params: { sessionId: "session-1", runId: "dwfrun-1", artifactId: "perf", limit: 200 },
      first: { items: [], hasMore: false },
      second: {
        items: [{ sequence: 3, siteId: "report#1", ordinal: 1, item: { round: 1 } }],
        hasMore: true,
      },
    },
    {
      method: "workflowRunArtifactRead" as const,
      params: {
        sessionId: "session-1",
        runId: "dwfrun-1",
        artifactId: "book",
        version: 1,
        offset: 0,
        limit: 4,
      },
      first: { dataBase64: "", mediaType: "application/pdf", totalBytes: 0, nextOffset: null },
      second: {
        dataBase64: "aGVsbG8=",
        mediaType: "application/pdf",
        totalBytes: 5,
        nextOffset: null,
      },
    },
    {
      method: "workflowRunWorkspace" as const,
      params: { sessionId: "session-1", runId: "dwfrun-1" },
      first: { nodes: [] },
      second: {
        nodes: [
          {
            siteId: "world-read#1",
            ordinal: 1,
            kind: "world-read" as const,
            op: "read",
            args: ["src/a.ts"],
            status: "completed" as const,
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        truncated: true,
      },
    },
    {
      method: "workflowRunNodeResult" as const,
      params: {
        sessionId: "session-1",
        runId: "dwfrun-1",
        siteId: "world-read#1",
        ordinal: 1,
        maxBytes: 4096,
      },
      first: { status: "running" as const, truncated: false, totalBytes: 0 },
      second: {
        status: "completed" as const,
        result: "export {};\n",
        truncated: false,
        totalBytes: 11,
      },
    },
  ];

  it.each(cases)("$method 原样转发给当前 transport，params 一个字段不动", async (testCase) => {
    const forward = vi.fn(async () => testCase.first);
    const transport = { [testCase.method]: forward } as unknown as ConversationTransport;
    const replaceable = new ReplaceableConversationTransport(transport);

    await expect(
      (replaceable[testCase.method] as (params: unknown) => Promise<unknown>)(testCase.params),
    ).resolves.toEqual(testCase.first);
    expect(forward).toHaveBeenCalledWith(testCase.params);
  });

  it.each(cases)("$method replace 之后转发给新 transport，旧的不再被打", async (testCase) => {
    const firstForward = vi.fn(async () => testCase.first);
    const secondForward = vi.fn(async () => testCase.second);
    const replaceable = new ReplaceableConversationTransport({
      [testCase.method]: firstForward,
    } as unknown as ConversationTransport);

    replaceable.replace({ [testCase.method]: secondForward } as unknown as ConversationTransport);
    await expect(
      (replaceable[testCase.method] as (params: unknown) => Promise<unknown>)(testCase.params),
    ).resolves.toEqual(testCase.second);
    expect(secondForward).toHaveBeenCalledWith(testCase.params);
    expect(firstForward).not.toHaveBeenCalled();
  });
});
