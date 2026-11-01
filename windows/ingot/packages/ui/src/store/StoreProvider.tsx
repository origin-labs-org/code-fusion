
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import type { IBroadcastService } from "@origin-ai/cf-services";
import { createCfStore, type CfStore, type CfState } from "./index.js";

export const StoreContext = createContext<CfStore | null>(null);

export function StoreProvider({
  broadcastService,
  initialIsRestoringOAuthSession = false,
  children,
}: {
  broadcastService: IBroadcastService;
  initialIsRestoringOAuthSession?: boolean;
  children: ReactNode;
}) {
  const storeRef = useRef<CfStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = createCfStore(broadcastService, {
      initialIsRestoringOAuthSession,
    });
  }

  return <StoreContext.Provider value={storeRef.current}>{children}</StoreContext.Provider>;
}

export function useCfStore<T>(selector: (state: CfState) => T): T {
  const store = useContext(StoreContext);
  if (!store) {
    throw new Error("useCfStore 必须在 StoreProvider 内使用");
  }
  return useStore(store, selector);
}

export function useCfStoreWithDefault<T>(
  selector: (state: CfState) => T,
  defaultValue: T,
): T {
  const store = useContext(StoreContext);
  const subscribe = useCallback(
    (onStoreChange: () => void) => (store ? store.subscribe(onStoreChange) : () => {}),
    [store],
  );
  const getSnapshot = () => (store ? selector(store.getState()) : defaultValue);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
