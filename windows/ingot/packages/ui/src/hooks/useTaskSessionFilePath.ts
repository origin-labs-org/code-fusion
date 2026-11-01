import { useEffect, useRef, useState } from "react";
import { logger } from "@/logger.js";
import { useCfTaskService } from "@/hooks/useCfTaskService.js";

export interface TaskSessionFilePathState {
  path: string | null;
  exists: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: TaskSessionFilePathState = {
  path: null,
  exists: false,
  loading: false,
  error: null,
};

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

export function useTaskSessionFilePath(
  workspacePath: string,
  taskId: string | null,
  workspaceIdentity?: string,
  options: { enabled?: boolean } = {},
) {
  const cfTaskService = useCfTaskService(workspacePath, undefined, workspaceIdentity);
  const [state, setState] = useState<TaskSessionFilePathState>(INITIAL_STATE);
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

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;

    setState({
      path: null,
      exists: false,
      loading: true,
      error: null,
    });

    void cfTaskService
      .getTaskSessionFilePath({
        workspacePath,
        taskId,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      })
      .then((result) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }

        setState({
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
        logger.warn("[useTaskSessionFilePath] 读取 task 快照路径失败", {
          workspacePath,
          taskId,
          workspaceIdentity,
          error: message,
        });
        setState({
          path: null,
          exists: false,
          loading: false,
          error: message,
        });
      });

    return () => {
      disposed = true;
    };
  }, [enabled, cfTaskService, taskId, workspaceIdentity, workspacePath]);

  return state;
}
