import { useEffect, useRef, useState } from "react";
import type { CfProvider } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { useCfTaskService } from "@/hooks/useCfTaskService.js";

export interface TaskNativeSessionLogFileState {
  provider: CfProvider | null;
  path: string | null;
  exists: boolean;
  loading: boolean;
  error: string | null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }

  return String(error);
}

const INITIAL_STATE: TaskNativeSessionLogFileState = {
  provider: null,
  path: null,
  exists: false,
  loading: false,
  error: null,
};

export function supportsTaskNativeSessionLogFile(
  _provider: CfProvider | null | undefined,
): boolean {
  return true;
}

export function useTaskNativeSessionLogFile(
  workspacePath: string,
  taskId: string | null,
  providerHint?: CfProvider | null,
  workspaceIdentity?: string,
  options: { enabled?: boolean } = {},
) {
  const cfTaskService = useCfTaskService(workspacePath, undefined, workspaceIdentity);
  const [state, setState] = useState<TaskNativeSessionLogFileState>(INITIAL_STATE);
  const requestVersionRef = useRef(0);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    let disposed = false;

    if (!enabled || !workspacePath || !taskId) {
      requestVersionRef.current += 1;
      setState(INITIAL_STATE);
      return () => {
        disposed = true;
      };
    }

    if (!supportsTaskNativeSessionLogFile(providerHint)) {
      requestVersionRef.current += 1;
      setState({
        provider: providerHint ?? null,
        path: null,
        exists: false,
        loading: false,
        error: null,
      });
      return () => {
        disposed = true;
      };
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    setState({
      provider: providerHint ?? null,
      path: null,
      exists: false,
      loading: true,
      error: null,
    });

    void cfTaskService
      .getTaskNativeSessionLogFile({
        taskId,
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      })
      .then((result) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }

        setState({
          provider: result.provider ?? providerHint ?? null,
          path: result.path,
          exists: result.exists,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }

        const message = getErrorMessage(error);
        logger.warn("[useTaskNativeSessionLogFile] 读取 task 原生日志路径失败", {
          workspacePath,
          taskId,
          providerHint,
          workspaceIdentity,
          error: message,
        });
        setState({
          provider: providerHint ?? null,
          path: null,
          exists: false,
          loading: false,
          error: message,
        });
      });

    return () => {
      disposed = true;
    };
  }, [enabled, cfTaskService, providerHint, taskId, workspaceIdentity, workspacePath]);

  return state;
}
