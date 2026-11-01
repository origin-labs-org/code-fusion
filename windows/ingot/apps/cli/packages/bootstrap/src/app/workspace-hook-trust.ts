import {
  createDefaultFileWorkspaceHookTrustStore,
} from "@origin-ai/cf-adapters/storage";
import {
  InMemoryWorkspaceHookPolicyProvider,
  WorkspaceHookTrustCoordinator,
  createWorkspaceHookRuntimeAdmission,
  emitWorkspaceHookTelemetry,
  type WorkspaceHookAdmissionState,
  type WorkspaceHookReviewTarget,
  type WorkspaceHookRuntimeAdmissionPort,
  type WorkspaceHookPolicyProvider,
} from "@origin-ai/cf-core";
import { SessionEventType } from "@origin-ai/cf-contracts";
import type {
  Logger,
  SessionId,
  WorkspaceHookBundleSnapshot,
  WorkspaceHookPolicy,
  WorkspaceHookAdmissionUpdatedPayload,
} from "@origin-ai/cf-contracts";
import type {
  WorkspaceHookReviewDecision,
  WorkspaceHookReviewRequestPayload,
  WorkspaceHookTrustRevokeTarget,
} from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkspaceHookRuntimeRoot } from "@origin-ai/cf-shared/workspace-hook-discovery";
import {
  WorkspaceHookReviewController,
  type WorkspaceHookReviewCommandResult,
  type WorkspaceHookReviewHostPort,
  type WorkspaceHookReviewLifecycleEvent,
} from "./workspace-hook-review-controller.js";
import { createWorkspaceHookReviewMutationPort } from "./workspace-hook-review-mutation.js";
import type { WorkspaceHookReviewHostContext } from "./types.js";

export interface WorkspaceHookRuntimeSecurity {
  admission: WorkspaceHookRuntimeAdmissionPort;
  snapshot: WorkspaceHookBundleSnapshot;
  
  reloadTrust(): Promise<void>;
  
  requestReview(target: {
    workspaceIdentity: string;
    bundleDigest: string;
  }): Promise<WorkspaceHookReviewCommandResult>;
  respond(
    target: WorkspaceHookReviewTarget,
    decision: WorkspaceHookReviewDecision,
  ): Promise<WorkspaceHookReviewCommandResult>;
  toggle(
    target: WorkspaceHookReviewTarget,
    reviewItemId: string,
    enabled: boolean,
  ): Promise<
    WorkspaceHookReviewCommandResult & {
      request?: WorkspaceHookReviewRequestPayload;
    }
  >;
  revoke(
    target: WorkspaceHookReviewTarget,
    reviewItemIds: readonly string[],
  ): Promise<WorkspaceHookReviewCommandResult>;
  revokeCurrent(target: WorkspaceHookTrustRevokeTarget): Promise<WorkspaceHookReviewCommandResult>;
}

export function createWorkspaceHookRuntimeSecurity(input: {
  appVersion?: string;
  emitAdmissionEvent?: (event: {
    type: typeof SessionEventType.WorkspaceHookAdmissionUpdated;
    payload: WorkspaceHookAdmissionUpdatedPayload;
  }) => Promise<void>;
  emitReviewEvent?: (event: WorkspaceHookReviewLifecycleEvent) => Promise<void>;
  logger: Logger;
  projectConfigPath?: string;
  policy?: WorkspaceHookPolicy;
  policyProvider?: WorkspaceHookPolicyProvider;
  reviewHost?: WorkspaceHookReviewHostContext;
  workspaceHookTrustEnabled?: boolean;
  runtimeRoot: WorkspaceHookRuntimeRoot;
  sessionId: SessionId;
  snapshot?: WorkspaceHookBundleSnapshot;
  userConfigPath: string;
  workingDirectory: string;
  
  homeDir?: string;
}): WorkspaceHookRuntimeSecurity | undefined {
  if (!input.snapshot) return undefined;
  const policyProvider =
    input.policyProvider ?? new InMemoryWorkspaceHookPolicyProvider(input.policy);
  const coordinator = new WorkspaceHookTrustCoordinator({
    coordinatorEpoch: crypto.randomUUID(),
    policyProvider,
  });
  const trustEnabled = input.workspaceHookTrustEnabled === true;
  const store = trustEnabled
    ? createDefaultFileWorkspaceHookTrustStore({
        userConfigPath: input.userConfigPath,
        ...(input.homeDir ? { homeDir: input.homeDir } : {}),
      })
    : undefined;
  const ready = trustEnabled
    ? loadWorkspaceHookTrustStore({
        coordinator,
        logger: input.logger,
        store: store as NonNullable<typeof store>,
      })
    : Promise.resolve();
  let controller: WorkspaceHookReviewController | undefined;
  const onAdmissionStateChanged:
    | ((state: WorkspaceHookAdmissionState) => void)
    | undefined = input.emitAdmissionEvent
    ? (state) => {
        void input.emitAdmissionEvent!({
          type: SessionEventType.WorkspaceHookAdmissionUpdated,
          payload: {
            pendingCount: state.pendingCount,
            bundleDigest: state.bundleDigest,
            ...(state.workspaceIdentity
              ? { workspaceIdentity: state.workspaceIdentity }
              : {}),
          },
        }).catch((error: unknown) => {
          input.logger.warn("Failed to emit WorkspaceHookAdmissionUpdated", {
            errorType: error instanceof Error ? error.name : typeof error,
            event: "workspace_hook.admission_event_emit_failed",
            module: "bootstrap.workspace_hook_trust",
          });
        });
      }
    : undefined;
  const admission = createWorkspaceHookRuntimeAdmission({
    coordinator,
    enabled: trustEnabled,
    logger: input.logger,
    ready,
    ...(onAdmissionStateChanged ? { onAdmissionStateChanged } : {}),
    snapshot: input.snapshot,
  });

  if (trustEnabled && input.reviewHost && input.emitReviewEvent) {
    const host: WorkspaceHookReviewHostPort = {
      ...input.reviewHost,
      emit: input.emitReviewEvent,
    };
    controller = new WorkspaceHookReviewController({
      admission,
      appVersion: input.appVersion,
      coordinator,
      host,
      logger: input.logger,
      mutation: createWorkspaceHookReviewMutationPort({
        workingDirectory: input.workingDirectory,
        workspaceIdentity: input.snapshot.workspaceIdentity,
        projectConfigPath: input.projectConfigPath,
        runtimeRoot: input.runtimeRoot,
      }),
      sessionId: input.sessionId,
      store: store as NonNullable<typeof store>,
    });
  }

  const unavailable = (): WorkspaceHookReviewCommandResult => ({
    accepted: false,
    reasonCode: trustEnabled
      ? "workspace_hooks_require_trust_capable_host"
      : "workspace_hooks_feature_disabled",
  });
  return {
    admission,
    snapshot: input.snapshot,
    reloadTrust: async () => {
      if (!trustEnabled || !store) return;
      await loadWorkspaceHookTrustStore({ coordinator, logger: input.logger, store });
      await admission.activate("resume");
    },
    requestReview: (target) =>
      controller
        ? controller.requestReview(target)
        : Promise.resolve(unavailable()),
    respond: (target, decision) =>
      controller ? controller.respond(target, decision) : Promise.resolve(unavailable()),
    toggle: (target, reviewItemId, enabled) =>
      controller
        ? controller.toggle(target, reviewItemId, enabled)
        : Promise.resolve(unavailable()),
    revoke: (target, reviewItemIds) =>
      controller ? controller.revoke(target, reviewItemIds) : Promise.resolve(unavailable()),
    revokeCurrent: (target) =>
      controller ? controller.revokeCurrent(target) : Promise.resolve(unavailable()),
  };
}

async function loadWorkspaceHookTrustStore(input: {
  coordinator: WorkspaceHookTrustCoordinator;
  logger: Logger;
  store: ReturnType<typeof createDefaultFileWorkspaceHookTrustStore>;
}): Promise<void> {
  try {
    const loaded = await (await input.store).load();
    input.coordinator.replacePersistentTrustRecords(loaded.records, {
      status: loaded.status,
      ...(loaded.status === "corrupt" ? { recoveredCorruptPath: loaded.recoveredCorruptPath } : {}),
    });
  } catch (error) {
    input.coordinator.replacePersistentTrustRecords([], { status: "corrupt" });
    emitWorkspaceHookTelemetry(input.logger, "workspace_hook.trust_store_failure", {
      reasonCode: "workspace_hooks_trust_store_corrupt",
    });
    input.logger.warn("Workspace Hook Trust store bootstrap failed closed", {
      errorType: error instanceof Error ? error.name : typeof error,
      event: "workspace_hook.trust_store.bootstrap_failed",
      module: "bootstrap.workspace_hook_trust",
      reasonCode: "workspace_hooks_trust_store_corrupt",
      status: "completed",
    });
  }
}
