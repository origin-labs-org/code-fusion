import { randomUUID } from "node:crypto";
import type { BrowserControlPort, TraceContext } from "@origin-ai/cf-contracts";
import {
  cfBrowserExecuteResultSchema,
  cfBrowserListResultSchema,
  cfProtocolMethods,
} from "@origin-ai/cf-shared";
import {
  protocolTraceFromTraceContext,
  requireSession,
  type CfProtocolAgentServerContext,
  type CfProtocolClientRequestOptions,
} from "./server-types.js";

interface ProtocolBrowserBrokerState {
  connectionsBySession: Map<string, Map<string, { browserId: string; browserGeneration: number }>>;
  
  childSessionParents: Map<string, string>;
  
  parentTabOwnerChildren: Set<string>;
}

const brokerStateByContext = new WeakMap<
  CfProtocolAgentServerContext,
  ProtocolBrowserBrokerState
>();

function brokerState(context: CfProtocolAgentServerContext): ProtocolBrowserBrokerState {
  let state = brokerStateByContext.get(context);
  if (!state) {
    state = {
      connectionsBySession: new Map(),
      childSessionParents: new Map(),
      parentTabOwnerChildren: new Set(),
    };
    brokerStateByContext.set(context, state);
  }
  return state;
}

export function createProtocolBrowserControlBroker(
  context: CfProtocolAgentServerContext,
): BrowserControlPort {
  const state = brokerState(context);
  const { connectionsBySession, childSessionParents } = state;

  const rememberConnection = (sessionId: string, browserId: string, browserGeneration: number) => {
    const connections = connectionsBySession.get(sessionId) ?? new Map();
    connections.set(`${browserId}\u0000${browserGeneration}`, { browserId, browserGeneration });
    connectionsBySession.set(sessionId, connections);
  };

  const sendLifecycle = async (
    sessionId: string,
    turnId: string | undefined,
    command:
      | { method: "turnEnded"; turnId?: string }
      | { method: "closeSession"; closeTabs?: boolean },
  ): Promise<void> => {
    const connections = [...(connectionsBySession.get(sessionId)?.values() ?? [])];
    await Promise.allSettled(
      connections.map(({ browserId, browserGeneration }) =>
        context.requestClient(
          cfProtocolMethods.interactionBrowserExecute,
          {
            ...buildBrowserRequestContext(context, state, { sessionId, turnId }),
            browserId,
            browserGeneration,
            command,
          },
          cfBrowserExecuteResultSchema,
        ),
      ),
    );
  };

  const port: BrowserControlPort = {
    async list({ sessionId, turnId, traceContext, signal }) {
      const result = await context.requestClient(
        cfProtocolMethods.interactionBrowserList,
        buildBrowserRequestContext(context, state, { sessionId, turnId, traceContext }),
        cfBrowserListResultSchema,
        buildRequestOptions(traceContext, signal),
      );
      return result.browsers;
    },

    async execute({
      browserId,
      browserGeneration,
      sessionId,
      turnId,
      command,
      traceContext,
      signal,
    }) {
      const requestContext = buildBrowserRequestContext(context, state, {
        sessionId,
        turnId,
        traceContext,
      });
      rememberConnection(requestContext.sessionId, browserId, browserGeneration);
      const cancelBackendRequest = () => {
        void context
          .requestClient(
            cfProtocolMethods.interactionBrowserExecute,
            {
              ...buildBrowserRequestContext(context, state, { sessionId, turnId, traceContext }),
              browserId,
              browserGeneration,
              command: { method: "cancelRequest", requestId: requestContext.requestId },
            },
            cfBrowserExecuteResultSchema,
            buildRequestOptions(traceContext, undefined),
          )
          .catch(() => undefined);
      };
      if (signal?.aborted) cancelBackendRequest();
      else signal?.addEventListener("abort", cancelBackendRequest, { once: true });
      try {
        return await context.requestClient(
          cfProtocolMethods.interactionBrowserExecute,
          {
            ...requestContext,
            browserId,
            browserGeneration,
            command,
          },
          cfBrowserExecuteResultSchema,
          buildRequestOptions(traceContext, signal),
        );
      } finally {
        signal?.removeEventListener("abort", cancelBackendRequest);
      }
    },

    async turnEnded({ sessionId, turnId }) {
      await sendLifecycle(sessionId, turnId, { method: "turnEnded", turnId });
    },

    async closeSession({ sessionId, turnId }) {
      await sendLifecycle(sessionId, turnId, { method: "closeSession" });
      connectionsBySession.delete(sessionId);
    },

    forChildSession({ childSessionId, parentSessionId, tabOwner = "child" }) {
      childSessionParents.set(childSessionId, parentSessionId);
      if (tabOwner === "parent") {
        state.parentTabOwnerChildren.add(childSessionId);
        const release = () => {
          if (childSessionParents.get(childSessionId) !== parentSessionId) return;
          childSessionParents.delete(childSessionId);
          state.parentTabOwnerChildren.delete(childSessionId);
        };
        return {
          list: port.list,
          execute: port.execute,
          async turnEnded() {},
          async closeSession() {
            release();
          },
        };
      }
      return {
        list: port.list,
        execute: port.execute,
        turnEnded: port.turnEnded,
        async closeSession({ sessionId, turnId }) {
          try {
            await sendLifecycle(sessionId, turnId, { method: "closeSession", closeTabs: true });
          } finally {
            connectionsBySession.delete(sessionId);
            if (childSessionParents.get(childSessionId) === parentSessionId) {
              childSessionParents.delete(childSessionId);
            }
          }
        },
      };
    },
  };
  return port;
}

function buildBrowserRequestContext(
  context: CfProtocolAgentServerContext,
  state: ProtocolBrowserBrokerState,
  input: {
    sessionId: string;
    turnId?: string;
    traceContext?: TraceContext;
  },
) {
  const parentSessionId = state.childSessionParents.get(input.sessionId);
  const record = requireSession(context, parentSessionId ?? input.sessionId);
  const workspaceIdentity = record.workspace.workspaceIdentity?.trim() || undefined;
  const remoteSessionId = record.workspace.remoteSessionId?.trim() || undefined;
  const workspacePath = record.workspace.workspacePath;

  return {
    requestId: randomUUID(),
    sessionId:
      parentSessionId !== undefined && state.parentTabOwnerChildren.has(input.sessionId)
        ? parentSessionId
        : input.sessionId,
    ...((input.turnId ?? input.traceContext?.turnId)
      ? { turnId: String(input.turnId ?? input.traceContext?.turnId) }
      : {}),
    workspaceKey: workspaceIdentity ?? workspacePath,
    workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
    ...(remoteSessionId ? { remoteSessionId } : {}),
    clientMode: record.deliveryKind ?? "desktop-continuous",
    sessionContext: "live" as const,
  };
}

function buildRequestOptions(
  traceContext: TraceContext | undefined,
  signal: AbortSignal | undefined,
): CfProtocolClientRequestOptions {
  return {
    ...(signal ? { signal } : {}),
    ...(traceContext ? { trace: protocolTraceFromTraceContext(traceContext) } : {}),
  };
}
