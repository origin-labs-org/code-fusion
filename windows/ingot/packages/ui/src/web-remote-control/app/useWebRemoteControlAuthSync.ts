import { useEffect, useRef } from "react";
import type {
  WebRemoteControlAuthPlatform,
  WebRemoteControlAuthEvents,
} from "@/web-remote-control/contract.js";

export function useWebRemoteControlAuthSync(
  platform: WebRemoteControlAuthPlatform,
  oauth: WebRemoteControlAuthEvents,
  userId: string | undefined,
  restoring: boolean,
): void {
  const initialStateSynced = useRef(false);
  useEffect(() => {
    initialStateSynced.current = false;
    if (!platform.notifyWebRemoteControlAuthStateChanged) return;
    const subscription = oauth.onDidChangeSession((state) => {
      initialStateSynced.current = true;
      platform.notifyWebRemoteControlAuthStateChanged?.({ state });
    });
    return () => subscription.dispose();
  }, [platform, oauth]);

  useEffect(() => {
    if (restoring || initialStateSynced.current) return;
    initialStateSynced.current = true;
    platform.notifyWebRemoteControlAuthStateChanged?.({
      state: userId ? "signed-in" : "signed-out",
    });
  }, [platform, oauth, userId, restoring]);
}
