import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Emitter } from "@origin-ai/cf-rpc";
import type { IServiceAccessor } from "@origin-ai/cf-services";

const { lifecycleWarn } = vi.hoisted(() => ({ lifecycleWarn: vi.fn() }));
vi.mock("@/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    lifecycle: { info: vi.fn(), warn: lifecycleWarn, error: vi.fn() },
  },
}));

import {
  acquireSessionsIndex,
  releaseSessionsIndex,
  resetSessionsIndexScopeEndpointMismatchReportsForTest,
  sessionsIndexRegistrySize,
  type SessionsIndexAgentService,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";
import {
  registerRemoteWorkspaceSession,
  unregisterRemoteWorkspaceSession,
} from "@/store/remoteWorkspaceSessionStore.js";

const workspacePath = "/root/src/plancov";
const workspaceIdentity = "remote:wsl:default:root:/root/src/plancov";
const remoteSessionId = "remote-session-plancov";

function mockAgentService(): SessionsIndexAgentService {
  const runtimeRestarts = new Emitter<{ workspaceKey: string }>();
  return {
    helloConversationV4: vi.fn(async () => ({
      kind: "hello" as const,
      protocolVersion: 3 as const,
      connectionId: "test-connection",
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
    subscribeSessionsIndexV4: vi.fn(async () => ({
      ack: { subscriptionId: "sub-1", mode: "snapshot" as const, logEpoch: "e1" },
    })),
    unsubscribeSessionsIndexV4: vi.fn(async () => {}),
    resyncSessionsIndexV4: vi.fn(async (params: { subscriptionId: string }) => ({
      ack: { subscriptionId: params.subscriptionId, mode: "snapshot" as const, logEpoch: "e1" },
    })),
    onDynamicSessionsIndexFrame: vi.fn(() => () => ({ dispose: () => {} })),
    onAgentRuntimeRestarted: runtimeRestarts.event,
  } as unknown as SessionsIndexAgentService;
}

const remoteScopeWithoutEndpoint: SessionsIndexScope = {
  workspaceKey: workspaceIdentity,
  workspacePath,
  workspaceIdentity,
};

describe("sessionsIndexRegistry scope endpoint mismatch observation", () => {
  let remoteService: SessionsIndexAgentService;

  beforeEach(() => {
    lifecycleWarn.mockClear();
    resetSessionsIndexScopeEndpointMismatchReportsForTest();
    remoteService = mockAgentService();
    registerRemoteWorkspaceSession({
      sessionId: remoteSessionId,
      services: { cfAgentService: remoteService } as unknown as IServiceAccessor,
    });
  });

  afterEach(() => {
    unregisterRemoteWorkspaceSession(remoteSessionId);
    expect(sessionsIndexRegistrySize()).toBe(0);
  });

  it("Log a lifecycle warn and deduplicate by scope when remote proxy lacks endpointKey", () => {
    const store = acquireSessionsIndex(remoteScopeWithoutEndpoint, remoteService);
    const storeAgain = acquireSessionsIndex(remoteScopeWithoutEndpoint, remoteService);

    expect(lifecycleWarn).toHaveBeenCalledTimes(1);
    expect(lifecycleWarn).toHaveBeenCalledWith(
      "[v4-sessions-index] Scope endpoint does not match remote proxy affiliation",
      expect.objectContaining({
        event: "v4.sessions_index.scope_endpoint_mismatch",
        endpointKey: "__base__",
        remoteSessionId,
        workspaceKey: workspaceIdentity,
        workspacePath,
      }),
    );

    releaseSessionsIndex(remoteScopeWithoutEndpoint, store);
    releaseSessionsIndex(remoteScopeWithoutEndpoint, storeAgain);
  });

  it("No warning when endpointKey matches remote proxy ownership", () => {
    const scope: SessionsIndexScope = {
      ...remoteScopeWithoutEndpoint,
      endpointKey: remoteSessionId,
    };
    const store = acquireSessionsIndex(scope, remoteService);

    expect(lifecycleWarn).not.toHaveBeenCalled();

    releaseSessionsIndex(scope, store);
  });

  it("Also warn when endpointKey points to another remote session", () => {
    const scope: SessionsIndexScope = {
      ...remoteScopeWithoutEndpoint,
      endpointKey: "remote-session-other",
    };
    const store = acquireSessionsIndex(scope, remoteService);

    expect(lifecycleWarn).toHaveBeenCalledTimes(1);
    expect(lifecycleWarn).toHaveBeenCalledWith(
      "[v4-sessions-index] Scope endpoint does not match remote proxy affiliation",
      expect.objectContaining({ endpointKey: "remote-session-other", remoteSessionId }),
    );

    releaseSessionsIndex(scope, store);
  });

  it("Local base proxy missing endpointKey is normal behavior, no warning", () => {
    const localService = mockAgentService();
    const scope: SessionsIndexScope = { workspaceKey: "D:\\ws", workspacePath: "D:\\ws" };
    const store = acquireSessionsIndex(scope, localService);

    expect(lifecycleWarn).not.toHaveBeenCalled();

    releaseSessionsIndex(scope, store);
  });
});
