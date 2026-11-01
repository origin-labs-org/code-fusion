import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GitBranchMutationResult,
  GitLocalBranchListResult,
  GitRepositorySummary,
} from "@origin-ai/cf-shared";
import { toast } from "@/components/ui/toast.js";
import {
  buildGitBranchAutoCommitMessage,
  getPrimaryGitBranchIssue,
  resolveGitBranchIssueMessageId,
  resolveGitBranchSuccessMessageId,
  summarizeGitBranchIssuePaths,
} from "@/git-branch-switcher/display.js";
import {
  buildGitBranchSwitchAssistState,
  formatGitBranchIssuePathList,
  hasGitCommitIdentity,
  type GitBranchSwitchAssistDialogStep,
  type GitBranchSwitchAssistState,
} from "@/git-branch-switcher/switchAssist.js";
import { useServices } from "@/hooks/useServices.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";

interface UseGitBranchSwitcherOptions {
  workspacePath: string;
  currentBranchName: string | null;
  headRefType: GitRepositorySummary["headRefType"];
  onRefreshGit: () => void;
}

export function useGitBranchSwitcher({
  workspacePath,
  currentBranchName,
  headRefType,
  onRefreshGit,
}: UseGitBranchSwitcherOptions) {
  const { gitService } = useServices();
  const { intl, locale } = useCfIntl();
  const numberFormatter = new Intl.NumberFormat(locale);
  const [open, setOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createBranchName, setCreateBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [commitError, setCommitError] = useState<string | null>(null);
  const [switchAssistStep, setSwitchAssistStep] = useState<GitBranchSwitchAssistDialogStep | null>(
    null,
  );
  const [switchAssistState, setSwitchAssistState] = useState<GitBranchSwitchAssistState | null>(
    null,
  );
  const [branchesResult, setBranchesResult] = useState<GitLocalBranchListResult | null>(null);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);

  const resetSwitchAssistState = useCallback(() => {
    setSwitchAssistStep(null);
    setSwitchAssistState(null);
    setCommitMessage("");
    setCommitError(null);
  }, []);

  const loadBranches = useCallback(async () => {
    setLoadingBranches(true);

    try {
      const nextResult = await gitService.getLocalBranches({ workspacePath });
      setBranchesResult(nextResult);
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[GitBranchSwitcher] 读取本地分支失败", {
        workspacePath,
        error: message,
      });
      toast(
        intl.formatMessage({ id: "git.branchSwitcher.error.requestFailed" }, { error: message }),
      );
    } finally {
      setLoadingBranches(false);
    }
  }, [gitService, intl, workspacePath]);

  useEffect(() => {
    setOpen(false);
    setCreateDialogOpen(false);
    setCreateBranchName("");
    setBranchesResult(null);
    resetSwitchAssistState();
  }, [resetSwitchAssistState, workspacePath]);

  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (openRef.current) {
      return;
    }
    setBranchesResult(null);
  }, [currentBranchName, headRefType]);

  useEffect(() => {
    if (!open) {
      return;
    }

    void loadBranches();
  }, [loadBranches, open]);

  const notifyMutationFailure = useCallback(
    (result: GitBranchMutationResult) => {
      const issue = getPrimaryGitBranchIssue(result.issues);
      const messageId = resolveGitBranchIssueMessageId(issue);
      if (!issue) {
        toast(intl.formatMessage({ id: "git.branchSwitcher.error.unknown" }));
        return;
      }

      if (messageId) {
        const { visiblePaths, remainingCount } = summarizeGitBranchIssuePaths(issue.paths);
        const extraPaths =
          remainingCount > 0
            ? intl.formatMessage(
                { id: "git.branchSwitcher.error.moreFiles" },
                { count: numberFormatter.format(remainingCount) },
              )
            : "";
        toast(
          intl.formatMessage(
            { id: messageId },
            {
              branchName: issue.detail ?? result.branchName ?? "",
              paths: formatGitBranchIssuePathList(locale, visiblePaths),
              extraPaths,
            },
          ),
        );
        return;
      }

      const fallbackMessage = issue.detail?.trim() || issue.message.trim();
      toast(
        fallbackMessage.length > 0
          ? fallbackMessage
          : intl.formatMessage({ id: "git.branchSwitcher.error.unknown" }),
      );
    },
    [intl, locale, numberFormatter],
  );

  const prepareSwitchAssistState = useCallback(
    async (result: GitBranchMutationResult): Promise<boolean> => {
      const nextSwitchAssistState = await buildGitBranchSwitchAssistState({
        gitService,
        workspacePath,
        result,
      });
      if (!nextSwitchAssistState) {
        return false;
      }

      setOpen(false);
      setCreateDialogOpen(false);
      setCommitError(null);
      setCommitMessage("");
      setSwitchAssistState(nextSwitchAssistState);
      setSwitchAssistStep("blocked");
      return true;
    },
    [gitService, workspacePath],
  );

  const handleMutationResult = useCallback(
    async (result: GitBranchMutationResult, actionLabel: string) => {
      if (!result.ok) {
        logger.warn("[GitBranchSwitcher] 分支变更被阻塞", {
          workspacePath,
          action: result.action,
          branchName: result.branchName,
          issues: result.issues.map((issue) => issue.code),
        });
        if (await prepareSwitchAssistState(result)) {
          return;
        }
        notifyMutationFailure(result);
        return;
      }

      const successMessageId = resolveGitBranchSuccessMessageId(result);
      if (successMessageId && result.branchName) {
        toast(intl.formatMessage({ id: successMessageId }, { branchName: result.branchName }));
      }

      logger.info(`[GitBranchSwitcher] ${actionLabel}成功`, {
        workspacePath,
        branchName: result.branchName,
        action: result.action,
        didChange: result.didChange,
        created: result.created,
      });

      setOpen(false);
      setCreateDialogOpen(false);
      setCreateBranchName("");
      resetSwitchAssistState();
      setBranchesResult((current) =>
        current
          ? {
              ...current,
              currentBranchName: result.summary.branchName,
              headRefType: result.summary.headRefType,
              branches: current.branches.map((branch) => ({
                ...branch,
                isCurrent:
                  result.summary.branchName !== null && branch.name === result.summary.branchName,
              })),
            }
          : current,
      );
      if (result.didChange || result.created) {
        onRefreshGit();
      }
    },
    [
      intl,
      notifyMutationFailure,
      onRefreshGit,
      prepareSwitchAssistState,
      resetSwitchAssistState,
      workspacePath,
    ],
  );

  const switchBranch = useCallback(
    async (targetBranchName: string) => {
      setOpen(false);
      setMutationPending(true);

      try {
        const result = await gitService.switchBranch({
          workspacePath,
          targetBranchName,
        });
        await handleMutationResult(result, "Switch Branch");
      } catch (error: unknown) {
        const message = getErrorMessage(error);
        logger.warn("[GitBranchSwitcher] 切换分支请求失败", {
          workspacePath,
          targetBranchName,
          error: message,
        });
        toast(
          intl.formatMessage({ id: "git.branchSwitcher.error.requestFailed" }, { error: message }),
        );
      } finally {
        setMutationPending(false);
      }
    },
    [gitService, handleMutationResult, intl, workspacePath],
  );

  const createBranchAndSwitch = useCallback(async () => {
    const branchName = createBranchName.trim();
    if (branchName.length === 0) {
      toast(intl.formatMessage({ id: "git.branchSwitcher.error.invalidBranchName" }));
      return;
    }

    setMutationPending(true);

    try {
      const result = await gitService.createBranchAndSwitch({
        workspacePath,
        branchName,
      });
      await handleMutationResult(result, "Create and Switch Branch");
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[GitBranchSwitcher] 创建并切换分支请求失败", {
        workspacePath,
        branchName,
        error: message,
      });
      toast(
        intl.formatMessage({ id: "git.branchSwitcher.error.requestFailed" }, { error: message }),
      );
    } finally {
      setMutationPending(false);
    }
  }, [createBranchName, gitService, handleMutationResult, intl, workspacePath]);

  const openSwitchCommitDialog = useCallback(() => {
    setCommitError(null);
    setSwitchAssistStep("commit");
  }, []);

  const closeSwitchAssistDialog = useCallback(() => {
    resetSwitchAssistState();
  }, [resetSwitchAssistState]);

  const commitAndSwitchBranch = useCallback(async () => {
    if (!switchAssistState) {
      return;
    }

    if (!hasGitCommitIdentity(switchAssistState.identity)) {
      setCommitError(
        intl.formatMessage({
          id: "git.branchSwitcher.commitDialog.identityMissing",
        }),
      );
      return;
    }

    const nextCommitMessage =
      commitMessage.trim() || buildGitBranchAutoCommitMessage(switchAssistState.targetBranchName);

    setCommitError(null);
    setMutationPending(true);

    try {
      logger.info("[GitBranchSwitcher] Starting commit and retrying branch switch", {
        workspacePath,
        targetBranchName: switchAssistState.targetBranchName,
        stagedPathCount: switchAssistState.stagePaths.length,
      });

      if (switchAssistState.stagePaths.length > 0) {
        await gitService.stagePaths({
          workspacePath,
          paths: switchAssistState.stagePaths,
        });
      }
      await gitService.commit({
        workspacePath,
        message: nextCommitMessage,
      });
      onRefreshGit();

      const result = await gitService.switchBranch({
        workspacePath,
        targetBranchName: switchAssistState.targetBranchName,
      });
      await handleMutationResult(result, "Commit and Switch Branch");
    } catch (error: unknown) {
      const message = getErrorMessage(error);
      logger.warn("[GitBranchSwitcher] 提交并切换分支失败", {
        workspacePath,
        targetBranchName: switchAssistState.targetBranchName,
        error: message,
      });
      setCommitError(
        intl.formatMessage(
          { id: "git.branchSwitcher.commitDialog.error.requestFailed" },
          { error: message },
        ),
      );
    } finally {
      setMutationPending(false);
    }
  }, [
    commitMessage,
    gitService,
    handleMutationResult,
    intl,
    onRefreshGit,
    switchAssistState,
    workspacePath,
  ]);

  return {
    open,
    setOpen,
    createDialogOpen,
    setCreateDialogOpen,
    createBranchName,
    setCreateBranchName,
    commitMessage,
    setCommitMessage,
    commitError,
    switchAssistStep,
    switchAssistState,
    branchesResult,
    loadingBranches,
    mutationPending,
    switchBranch,
    createBranchAndSwitch,
    openSwitchCommitDialog,
    closeSwitchAssistDialog,
    commitAndSwitchBranch,
  };
}
