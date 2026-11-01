
import { useCallback } from "react";
import { logger } from "../logger.js";
import { useServices } from "./useServices.js";

export function useTokenRefresh() {
  const { oauthService } = useServices();

  
  const tryRefresh = useCallback(async (): Promise<boolean> => {
    try {
      await oauthService.refreshToken();
      logger.info("[useTokenRefresh] token 刷新成功");
      return true;
    } catch (err) {
      logger.error("[useTokenRefresh] Token refresh failed:", err);
      return false;
    }
  }, [oauthService]);

  
  const clearCredentials = useCallback(async () => {
    await oauthService.logoutAll();
  }, [oauthService]);

  return { tryRefresh, clearCredentials };
}
