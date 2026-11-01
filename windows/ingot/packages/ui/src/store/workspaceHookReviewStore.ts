import { create } from "zustand";
import type {
  CommandAck,
  CommandEnvelope,
  WorkspaceHookReviewRequestPayload,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import { verdictWorkspaceHookReviewRequest } from "@origin-ai/cf-shared/workspace-hook-review-monotonicity";

export interface WorkspaceHookCommandBinding {
  sessionId: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  sendCommand(envelope: CommandEnvelope): Promise<CommandAck>;
  onCommandSettled?: (commandId: string) => void;
}

export interface WorkspaceHookReviewBinding {
  request: WorkspaceHookReviewRequestPayload;
  workspacePath: string;
  sendCommand(envelope: CommandEnvelope): Promise<CommandAck>;
  onCommandSettled?: (commandId: string) => void;
}

interface WorkspaceHookReviewState {
  bindings: Record<string, WorkspaceHookReviewBinding>;
  commandBindings: Record<string, WorkspaceHookCommandBinding>;
  connect(sessionId: string, binding: WorkspaceHookCommandBinding): void;
  disconnect(sessionId: string, sendCommand: WorkspaceHookCommandBinding["sendCommand"]): void;
  upsert(sessionId: string, binding: WorkspaceHookReviewBinding): void;
  clear(sessionId: string, interactionId?: string): void;
}

export const useWorkspaceHookReviewStore = create<WorkspaceHookReviewState>((set) => ({
  bindings: {},
  commandBindings: {},
  connect: (sessionId, binding) =>
    set((state) => ({
      commandBindings: { ...state.commandBindings, [sessionId]: binding },
    })),
  disconnect: (sessionId, sendCommand) =>
    set((state) => {
      const current = state.commandBindings[sessionId];
      if (!current || current.sendCommand !== sendCommand) return state;
      const commandBindings = { ...state.commandBindings };
      delete commandBindings[sessionId];
      const review = state.bindings[sessionId];
      if (!review || review.sendCommand !== sendCommand) return { commandBindings };
      const bindings = { ...state.bindings };
      delete bindings[sessionId];
      return { bindings, commandBindings };
    }),
  upsert: (sessionId, binding) =>
    set((state) => {
      const commandBinding = state.commandBindings[sessionId];
      if (commandBinding && commandBinding.sendCommand !== binding.sendCommand) {
        return state;
      }
      const current = state.bindings[sessionId];
      if (current) {
        const verdict = verdictWorkspaceHookReviewRequest(current.request, binding.request);
        if (verdict === "same_flow_stale" || verdict === "same_flow_replay" ||
          verdict === "same_flow_conflict") {
          return state;
        }
      }
      return { bindings: { ...state.bindings, [sessionId]: binding } };
    }),
  clear: (sessionId, interactionId) =>
    set((state) => {
      const current = state.bindings[sessionId];
      if (!current || (interactionId && current.request.interactionId !== interactionId)) {
        return state;
      }
      const bindings = { ...state.bindings };
      delete bindings[sessionId];
      return { bindings };
    }),
}));

export function findWorkspaceHookReviewBinding(
  bindings: Record<string, WorkspaceHookReviewBinding>,
  workspacePath?: string | null,
  workspaceIdentity?: string,
): WorkspaceHookReviewBinding | undefined {
  return Object.values(bindings)
    .filter((binding) =>
      matchesWorkspaceBinding({
        bindingWorkspaceIdentity: binding.request.workspaceIdentity,
        bindingWorkspacePath: binding.workspacePath,
        workspaceIdentity,
        workspacePath,
      }),
    )
    .sort((left, right) => right.request.createdAt - left.request.createdAt)[0];
}

const TRUSTABLE_WORKSPACE_HOOK_STATES = new Set([
  "pending_trust",
  "revoked",
  "stale_digest",
]);

export function findWorkspaceHookReviewBindingForItem(
  bindings: Record<string, WorkspaceHookReviewBinding>,
  input: {
    workspacePath?: string | null;
    workspaceIdentity?: string;
    bundleDigest: string;
    reviewItemId: string;
  },
): WorkspaceHookReviewBinding | undefined {
  return Object.values(bindings)
    .filter(
      (binding) =>
        matchesWorkspaceBinding({
          bindingWorkspaceIdentity: binding.request.workspaceIdentity,
          bindingWorkspacePath: binding.workspacePath,
          workspaceIdentity: input.workspaceIdentity,
          workspacePath: input.workspacePath,
        }) &&
        binding.request.bundleDigest === input.bundleDigest &&
        binding.request.items.some(
          (item) =>
            item.reviewItemId === input.reviewItemId &&
            TRUSTABLE_WORKSPACE_HOOK_STATES.has(item.trustState),
        ),
    )
    .sort((left, right) => right.request.createdAt - left.request.createdAt)[0];
}

export function waitForWorkspaceHookReviewBindingForItem(
  input: {
    workspacePath?: string | null;
    workspaceIdentity?: string;
    bundleDigest: string;
    reviewItemId: string;
  },
  timeoutMs: number,
): Promise<WorkspaceHookReviewBinding | undefined> {
  const current = findWorkspaceHookReviewBindingForItem(
    useWorkspaceHookReviewStore.getState().bindings,
    input,
  );
  if (current) return Promise.resolve(current);

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const timer = globalThis.setTimeout(() => finish(undefined), timeoutMs);
    const finish = (binding: WorkspaceHookReviewBinding | undefined) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timer);
      unsubscribe();
      resolve(binding);
    };
    unsubscribe = useWorkspaceHookReviewStore.subscribe((state) => {
      const binding = findWorkspaceHookReviewBindingForItem(state.bindings, input);
      if (binding) finish(binding);
    });

    const afterSubscribe = findWorkspaceHookReviewBindingForItem(
      useWorkspaceHookReviewStore.getState().bindings,
      input,
    );
    if (afterSubscribe) finish(afterSubscribe);
  });
}

export function findWorkspaceHookCommandBinding(
  bindings: Record<string, WorkspaceHookCommandBinding>,
  workspacePath?: string | null,
  workspaceIdentity?: string,
): WorkspaceHookCommandBinding | undefined {
  return Object.values(bindings).find((binding) =>
    matchesWorkspaceBinding({
      bindingWorkspaceIdentity: binding.workspaceIdentity,
      bindingWorkspacePath: binding.workspacePath,
      workspaceIdentity,
      workspacePath,
    }),
  );
}

function matchesWorkspaceBinding(input: {
  bindingWorkspaceIdentity?: string;
  bindingWorkspacePath: string;
  workspaceIdentity?: string;
  workspacePath?: string | null;
}): boolean {
  const workspaceKey = input.workspaceIdentity?.trim() || input.workspacePath;
  if (!workspaceKey) return false;
  const bindingWorkspaceIdentity = input.bindingWorkspaceIdentity?.trim();
  if (bindingWorkspaceIdentity) {
    return bindingWorkspaceIdentity === workspaceKey;
  }
  return !input.workspaceIdentity?.trim() && input.bindingWorkspacePath === input.workspacePath;
}
