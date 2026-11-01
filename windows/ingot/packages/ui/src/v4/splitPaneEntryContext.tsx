import { createContext, useContext, useMemo, type ReactNode } from "react";

interface V4SplitPaneEntryContextValue {
  readonly enabled: boolean;
}

const V4SplitPaneEntryContext = createContext<V4SplitPaneEntryContextValue>({ enabled: false });

export function V4SplitPaneEntryProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const value = useMemo<V4SplitPaneEntryContextValue>(() => ({ enabled }), [enabled]);
  return (
    <V4SplitPaneEntryContext.Provider value={value}>{children}</V4SplitPaneEntryContext.Provider>
  );
}

export function useV4SplitPaneEntry(): V4SplitPaneEntryContextValue {
  return useContext(V4SplitPaneEntryContext);
}
