import type { Hook } from "@origin-ai/cf-shared";
import { CircleAlert } from "lucide-react";
import { useCfIntl } from "@/i18n/IntlProvider.js";

export function requiresWorkspaceHookTrust(hook: Hook): boolean {
  return Boolean(hook.workspaceHook) && hook.workspaceHook?.trustState !== "trusted_persistent";
}

export function hasWorkspaceHooksRequiringReview(hooks: readonly Hook[]): boolean {
  return hooks.some(requiresWorkspaceHookTrust);
}

export function shouldShowWorkspaceHookTrustNotice({
  hooks,
  loadedWorkspaceKey,
  rpcReady,
  targetWorkspaceKey,
}: {
  hooks: readonly Hook[];
  loadedWorkspaceKey: string | null;
  rpcReady: boolean;
  targetWorkspaceKey: string | null;
}): boolean {
  return (
    rpcReady &&
    targetWorkspaceKey !== null &&
    loadedWorkspaceKey === targetWorkspaceKey &&
    hasWorkspaceHooksRequiringReview(hooks)
  );
}

export function WorkspaceHookTrustNotice({ hooks }: { hooks: readonly Hook[] }) {
  const { intl } = useCfIntl();

  if (!hasWorkspaceHooksRequiringReview(hooks)) return null;

  return (
    <div
      role="note"
      data-testid="workspace-hook-trust-notice"
      className="flex w-full items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-ui-base text-foreground"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <p className="min-w-0">{intl.formatMessage({ id: "settings.hooks.review.notice" })}</p>
    </div>
  );
}
