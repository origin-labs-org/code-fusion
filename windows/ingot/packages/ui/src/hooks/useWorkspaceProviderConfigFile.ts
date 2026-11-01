import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CfProvider } from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { shouldEnableWorkspaceRpc } from "@/lib/workspaceRpcAvailability.js";
import { useCfTaskService } from "@/hooks/useCfTaskService.js";
import { useRemoteWorkspaceSessionStore } from "@/store/remoteWorkspaceSessionStore.js";
import { useResolvedRemoteWorkspaceSessionId } from "@/hooks/useResolvedRemoteWorkspaceSessionId.js";
import type { ICfTaskService } from "@origin-ai/cf-services";

interface WorkspaceProviderConfigFileState {
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

const INITIAL_STATE: WorkspaceProviderConfigFileState = {
  path: null,
  exists: false,
  loading: true,
  error: null,
};

type WorkspaceProviderConfigServiceScope = "workspace" | "base";

export function resolveWorkspaceProviderConfigCfService(params: {
  configuredServiceScope: WorkspaceProviderConfigServiceScope;
  workspaceCfService: ICfTaskService;
  baseCfService: ICfTaskService | null;
  remoteSessionId: string | null;
}): ICfTaskService | null {
  if (params.configuredServiceScope === "workspace") {
    return params.workspaceCfService;
  }

  if (params.baseCfService) {
    return params.baseCfService;
  }

  if (params.remoteSessionId) {
    return null;
  }

  return params.workspaceCfService;
}

export function useWorkspaceProviderConfigFile(
  workspacePath: string,
  provider: CfProvider,
  preferredRemoteSessionId?: string | null,
  workspaceIdentity?: string,
  options?: {
    serviceScope?: "workspace" | "base";
    enabled?: boolean;
  },
) {
  const workspaceCfService = useCfTaskService(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  const configuredServiceScope = options?.serviceScope ?? "workspace";
  const enabled = options?.enabled ?? true;
  const remoteSessionId = useResolvedRemoteWorkspaceSessionId(
    workspacePath,
    preferredRemoteSessionId,
    workspaceIdentity,
  );
  const baseCfService = useRemoteWorkspaceSessionStore(
    (state) => state.baseServices?.cfTaskService ?? null,
  );
  const workspaceRpcEnabled = shouldEnableWorkspaceRpc({
    workspaceIdentity,
    remoteSessionId,
  });
  const cfTaskService = resolveWorkspaceProviderConfigCfService({
    configuredServiceScope,
    workspaceCfService,
    baseCfService,
    remoteSessionId,
  });
  const cfServiceScope =
    configuredServiceScope === "base"
      ? "base"
      : remoteSessionId && workspaceCfService !== baseCfService
        ? "remote"
        : "base";
  const [state, setState] =
    useState<WorkspaceProviderConfigFileState>(INITIAL_STATE);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestVersionRef = useRef(0);

  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let disposed = false;

    if (!workspacePath || !enabled || !workspaceRpcEnabled) {
      requestVersionRef.current += 1;
      setState({
        path: null,
        exists: false,
        loading: false,
        error: null,
      });
      return () => {
        disposed = true;
      };
    }

    if (!cfTaskService) {
      requestVersionRef.current += 1;
      setState({
        path: null,
        exists: false,
        loading: true,
        error: null,
      });
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

    logger.info(
      `[useWorkspaceProviderConfigFile] StartRead provider Configuration路径 workspace=${workspacePath} provider=${provider} scope=${cfServiceScope} session=${remoteSessionId ?? "none"}`,
    );

    void cfTaskService
      .getWorkspaceProviderConfigFile({
        workspacePath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        provider,
      })
      .then((result) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }

        logger.info(
          `[useWorkspaceProviderConfigFile] Read provider Configuration路径成功 workspace=${workspacePath} provider=${provider} scope=${cfServiceScope} session=${remoteSessionId ?? "none"} exists=${result.exists} path=${result.path}`,
        );

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
        logger.warn("[useWorkspaceProviderConfigFile] 读取 provider 配置路径失败", {
          workspacePath,
          provider,
          scope: cfServiceScope,
          remoteSessionId,
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
  }, [
    cfTaskService,
    cfServiceScope,
    enabled,
    provider,
    refreshVersion,
    remoteSessionId,
    workspaceIdentity,
    workspacePath,
    workspaceRpcEnabled,
  ]);

  return useMemo(
    () => ({
      ...state,
      refresh,
    }),
    [refresh, state],
  );
}
