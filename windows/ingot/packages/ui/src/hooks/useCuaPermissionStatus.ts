//
//
import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { CuaPermissionStatusQueryOptions, CuaPermissionStatusResult } from "@origin-ai/cf-services";
import {
  cuaPermissionStatusKey,
  fetchCuaPermissionStatus,
  getCuaPermissionStatusSnapshot,
  subscribeCuaPermissionStatus,
} from "@/lib/cuaPermissionStatusStore.js";
import { useOptionalServices } from "./useServices.js";

export function useCuaPermissionStatus(
  workspacePath: string | null,
  workspaceIdentity?: string,
): {
  status: CuaPermissionStatusResult | null;
  fresh: boolean;
  
  settled: boolean;
  refresh: (options?: CuaPermissionStatusQueryOptions) => void;
} {
  const services = useOptionalServices();
  const cuaPermissionService = services?.cuaPermissionService;
  const key =
    workspacePath && cuaPermissionService
      ? cuaPermissionStatusKey(workspacePath, workspaceIdentity)
      : null;

  const snapshot = useSyncExternalStore(
    subscribeCuaPermissionStatus,
    useCallback(() => getCuaPermissionStatusSnapshot(key), [key]),
  );

  const query = useCallback(
    (mode: "refresh" | "ensure", options?: CuaPermissionStatusQueryOptions): void => {
      if (!workspacePath || !cuaPermissionService) return;
      fetchCuaPermissionStatus({
        service: cuaPermissionService,
        workspacePath,
        mode,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(options ? { options } : {}),
      });
    },
    [cuaPermissionService, workspaceIdentity, workspacePath],
  );

  const refresh = useCallback(
    (options?: CuaPermissionStatusQueryOptions): void => query("refresh", options),
    [query],
  );

  useEffect(() => {
    if (!workspacePath || !cuaPermissionService) return;
    query("ensure");
    const onFocus = (): void => query("refresh");
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [cuaPermissionService, query, workspacePath]);

  return {
    status: snapshot.status,
    fresh: snapshot.fresh,
    settled: snapshot.settled,
    refresh,
  };
}
