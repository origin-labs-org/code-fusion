import { resolve } from "node:path";
import { workspaceHookPolicySchema } from "@origin-ai/cf-contracts";
import type { WorkspaceHookPolicyProvider } from "@origin-ai/cf-core";
import {
  cfWorkspaceHookTrustGrantParamsSchema,
  cfWorkspaceHookTrustGrantReasonCodeSchema,
  cfWorkspaceHookTrustGrantResultSchema,
  type CfWorkspaceHookTrustGrantReasonCode,
  type CfWorkspaceHookTrustGrantResult,
} from "@origin-ai/cf-shared";
import {
  grantWorkspaceHookTrust,
  type WorkspaceHookTrustCliStatus,
} from "../workspace-hook-trust-cli.js";

type GrantWorkspaceHookTrust = typeof grantWorkspaceHookTrust;

export async function grantWorkspaceHookTrustForProtocol(
  rawParams: unknown,
  dependencies: {
    appVersion?: string;
    grant?: GrantWorkspaceHookTrust;
    policyProvider: WorkspaceHookPolicyProvider;
  },
): Promise<CfWorkspaceHookTrustGrantResult> {
  const params = cfWorkspaceHookTrustGrantParamsSchema.parse(rawParams);
  const grant = dependencies.grant ?? grantWorkspaceHookTrust;
  const workspaceIdentity =
    params.workspace.workspaceIdentity?.trim() || resolve(params.workspace.workspacePath);
  const policyRejection = getPolicyRejectionReason(
    dependencies.policyProvider,
    workspaceIdentity,
  );
  if (policyRejection) {
    return cfWorkspaceHookTrustGrantResultSchema.parse({
      accepted: false,
      reasonCode: policyRejection,
    });
  }
  try {
    const status = await grant({
      workspacePath: params.workspace.workspacePath,
      ...(params.workspace.workspaceIdentity
        ? { workspaceIdentity: params.workspace.workspaceIdentity }
        : {}),
      bundleDigest: params.bundleDigest,
      hookDeclarationDigests: [params.hookDeclarationDigest],
      ...(dependencies.appVersion ? { appVersion: dependencies.appVersion } : {}),
    });
    return cfWorkspaceHookTrustGrantResultSchema.parse(
      didGrantExactDeclaration(status, params.hookDeclarationDigest)
        ? { accepted: true }
        : { accepted: false, reasonCode: toPublicReasonCode(status.reasonCode) },
    );
  } catch (error) {
    return cfWorkspaceHookTrustGrantResultSchema.parse({
      accepted: false,
      reasonCode: toPublicReasonCode(error),
    });
  }
}

function getPolicyRejectionReason(
  policyProvider: WorkspaceHookPolicyProvider,
  workspaceIdentity: string,
): CfWorkspaceHookTrustGrantReasonCode | undefined {
  try {
    const policy = workspaceHookPolicySchema.parse(
      policyProvider.getPolicy(workspaceIdentity),
    );
    if (policy.mode === "user_decides") return undefined;
    return policy.mode === "allow_trusted_only"
      ? "workspace_hooks_policy_requires_pretrust"
      : "workspace_hooks_blocked_by_policy";
  } catch {
    return "workspace_hooks_blocked_by_policy";
  }
}

function toPublicReasonCode(error: unknown): CfWorkspaceHookTrustGrantReasonCode {
  const candidate = error instanceof Error ? error.message : error;
  const parsed = cfWorkspaceHookTrustGrantReasonCodeSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;

  return "workspace_hooks_config_unreadable";
}

function didGrantExactDeclaration(
  status: WorkspaceHookTrustCliStatus,
  hookDeclarationDigest: string,
): boolean {
  return status.items.some(
    (item) =>
      item.hookDeclarationDigest === hookDeclarationDigest &&
      item.trustState === "trusted_persistent",
  );
}
