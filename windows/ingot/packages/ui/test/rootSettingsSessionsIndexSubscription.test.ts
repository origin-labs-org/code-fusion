import { describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type {
  SessionSummary,
  SessionsIndexTopicFrame,
  SessionsIndexTopicWireFrame,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolveRootWorkspaceShellTarget } from "@/root/rootWorkspaceShellTarget.js";
import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  sessionsIndexRegistrySize,
  type SessionsIndexAgentService,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";

const workspacePath = "/root/src/plancov";
const workspaceIdentity = "remote:wsl:default:root:/root/src/plancov";
const remoteSessionId = "df0312a2-2628-4215-8556-2f5e4c33b394";

function createSingleConnectionRemoteService(): {
  service: SessionsIndexAgentService;
  emitUpsert(session: SessionSummary): void;
} {
  let nextSubscription = 1;
  let nextLogicalFrame = 1;
  let currentSeq = 1;
  let activeSubscriptionId: string | null = null;
  const listeners = new Set<(frame: SessionsIndexTopicWireFrame) => void>();
  const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
  const topic = `sessions-index/${workspaceIdentity}`;

  const physicalFrame = (
    frame: SessionsIndexTopicFrame,
    deliveryKind: "initial" | "online",
  ): SessionsIndexTopicWireFrame => ({
    wireVersion: 3,
    kind: "complete",
    deliveryKind,
    logicalFrameId: `logical-${nextLogicalFrame}`,
    logicalFrameOrdinal: nextLogicalFrame++,
    topic: frame.topic,
    subscriptionId: frame.subscriptionId,
    frame,
  });

  const service = {
    helloConversationV4: vi.fn(async () => ({
      kind: "hello" as const,
      protocolVersion: 3 as const,
      connectionId: "host-rpc-plancov-attachment",
      clientMode: "desktop-continuous" as const,
      deliveryProfile: "continuous" as const,
      serverTime: 1,
      capabilities: {
        nativeDialogs: true,
        localTerminal: true,
        binaryFrames: false,
        compression: "none" as const,
      },
      auth: {},
    })),
    initializeConversationV4: vi.fn(async () => {}),
    subscribeSessionsIndexV4: vi.fn(async () => {
      const subscriptionId = `six-${nextSubscription++}`;
      activeSubscriptionId = subscriptionId;
      const initial = physicalFrame(
        {
          topic,
          subscriptionId,
          fromSeq: 0,
          toSeq: currentSeq,
          sentAt: 1,
          payload: {
            kind: "snapshot",
            snapshot: {
              protocolVersion: 1,
              workspaceId: workspaceIdentity,
              logEpoch: "epoch-1",
              sessions: [],
            },
          },
        },
        "initial",
      );
      for (const listener of listeners) listener(initial);
      return { ack: { subscriptionId, mode: "snapshot" as const, logEpoch: "epoch-1" } };
    }),
    unsubscribeSessionsIndexV4: vi.fn(async (params: { subscriptionId: string }) => {
      if (activeSubscriptionId === params.subscriptionId) activeSubscriptionId = null;
    }),
    resyncSessionsIndexV4: vi.fn(async (params: { subscriptionId: string }) => ({
      ack: {
        subscriptionId: params.subscriptionId,
        mode: "snapshot" as const,
        logEpoch: "epoch-1",
      },
    })),
    onDynamicSessionsIndexFrame: vi.fn(
      () => (listener: (frame: SessionsIndexTopicWireFrame) => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
      },
    ),
    onAgentRuntimeRestarted: runtimeRestarts.event,
  } as unknown as SessionsIndexAgentService;

  return {
    service,
    emitUpsert(session) {
      if (!activeSubscriptionId) return;
      const frame: SessionsIndexTopicFrame = {
        topic,
        subscriptionId: activeSubscriptionId,
        fromSeq: currentSeq,
        toSeq: currentSeq + 1,
        sentAt: 2,
        payload: { kind: "deltas", deltas: [{ op: "session.upserted", session }] },
      };
      currentSeq += 1;
      for (const listener of listeners) listener(physicalFrame(frame, "online"));
    },
  };
}

function summary(phase: SessionSummary["phase"], lastActivityAt: number): SessionSummary {
  return {
    sessionId: "sess_b8d3c760",
    workspaceId: workspaceIdentity,
    title: "EDGES视图覆盖情况可视化方案",
    phase,
    sessionEnded: phase === "completedSuccess",
    hasBackgroundWork: false,
    lastActivityAt,
    createdAt: 1,
  };
}

function notificationScopeFromShellTarget(target: {
  workspaceShellPath: string | null;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
}): SessionsIndexScope {
  const path = target.workspaceShellPath ?? "";
  return {
    workspaceKey: target.workspaceIdentity ?? path,
    workspacePath: path,
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
    ...(target.workspaceRemoteSessionId ? { endpointKey: target.workspaceRemoteSessionId } : {}),
  };
}

describe("sessions-index single-subscription invariant when Settings covers remote workspace", () => {
  it("Notification hook reuses sidebar subscription; sidebar still receives task completions after closing Settings", async () => {
    const { service, emitUpsert } = createSingleConnectionRemoteService();
    const remoteTab = { workspacePath, workspaceIdentity, remoteSessionId };
    const sidebarScope: SessionsIndexScope = {
      workspaceKey: workspaceIdentity,
      workspacePath,
      workspaceIdentity,
      endpointKey: remoteSessionId,
    };

    const sidebarStore = acquireSessionsIndex(sidebarScope, service);
    await vi.waitFor(() => expect(sidebarStore.getState().workspaceId).toBe(workspaceIdentity));
    emitUpsert(summary("running", 100));
    await vi.waitFor(() => expect(sidebarStore.getSessions()[0]?.phase).toBe("running"));

    const shellTarget = resolveRootWorkspaceShellTarget({
      activeWorkspaceTab: null,
      activeWorkspacePath: workspacePath,
      activeWorkspaceIdentity: workspaceIdentity,
      workspaceTabs: [remoteTab],
    });
    const notificationStore = acquireSessionsIndex(
      notificationScopeFromShellTarget(shellTarget),
      service,
    );

    expect(notificationStore).toBe(sidebarStore);
    expect(sessionsIndexRegistrySize()).toBe(1);
    expect(service.subscribeSessionsIndexV4).toHaveBeenCalledTimes(1);

    releaseSessionsIndex(notificationScopeFromShellTarget(shellTarget), notificationStore);
    expect(service.unsubscribeSessionsIndexV4).not.toHaveBeenCalled();

    emitUpsert(summary("completedSuccess", 200));
    await vi.waitFor(() => {
      const [session] = sidebarStore.getSessions();
      expect(session?.phase).toBe("completedSuccess");
      expect(session?.lastActivityAt).toBe(200);
    });

    releaseSessionsIndex(sidebarScope, sidebarStore);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });
});
