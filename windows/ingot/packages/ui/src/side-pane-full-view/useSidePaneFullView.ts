import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  SidePaneFullViewController,
  SidePaneFullViewFloating,
  SidePaneFullViewState,
  SidePaneFullViewSurface,
} from "@/side-pane-full-view/contract.js";
import { SIDE_PANE_FULL_VIEW_ENTER_STATE } from "@/side-pane-full-view/model.js";
import {
  buildTaskSidePaneMemoryKey,
  peekTaskSidePaneFullView,
  saveTaskSidePaneFullView,
} from "@/lib/taskSidePaneMemory.js";

export function useSidePaneFullView({
  workspacePath,
  workspaceIdentity,
  ownerId,
  isSidePaneOpen,
  enabled,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  ownerId: string | null;
  isSidePaneOpen: boolean;
  enabled: boolean;
}): SidePaneFullViewController {
  const memoryKey = buildTaskSidePaneMemoryKey({
    workspacePath,
    workspaceIdentity,
    taskId: ownerId,
  });
  const scope = `${memoryKey ?? ""}::${ownerId ?? ""}`;
  const [snapshot, setSnapshot] = useState(() => ({
    scope,
    value: peekTaskSidePaneFullView(memoryKey, ownerId),
  }));
  const stored =
    snapshot.scope === scope ? snapshot.value : peekTaskSidePaneFullView(memoryKey, ownerId);
  const latestRef = useRef({ memoryKey, ownerId, scope, stored });
  latestRef.current = { memoryKey, ownerId, scope, stored };

  const write = useCallback((value: SidePaneFullViewState | null) => {
    const latest = latestRef.current;
    saveTaskSidePaneFullView(latest.memoryKey, latest.ownerId, value);
    latestRef.current = { ...latest, stored: value };
    setSnapshot({ scope: latest.scope, value });
  }, []);

  const previousRef = useRef({ scope, isSidePaneOpen });
  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = { scope, isSidePaneOpen };
    if (previous.scope === scope && previous.isSidePaneOpen && !isSidePaneOpen) {
      if (latestRef.current.stored) write(null);
    }
  }, [isSidePaneOpen, scope, write]);

  const active = enabled && isSidePaneOpen;
  const fullView = active ? stored : null;
  const activeRef = useRef(active);
  activeRef.current = active;

  const enter = useCallback(() => {
    if (!activeRef.current || latestRef.current.stored) return;
    write(SIDE_PANE_FULL_VIEW_ENTER_STATE);
  }, [write]);
  const exit = useCallback(() => {
    if (latestRef.current.stored) write(null);
  }, [write]);
  const toggle = useCallback(() => {
    if (latestRef.current.stored) {
      write(null);
    } else if (activeRef.current) {
      write(SIDE_PANE_FULL_VIEW_ENTER_STATE);
    }
  }, [write]);
  const setSurface = useCallback(
    (surface: SidePaneFullViewSurface) => {
      const current = latestRef.current.stored;
      if (current && current.surface !== surface) write({ ...current, surface });
    },
    [write],
  );
  const setFloating = useCallback(
    (floating: SidePaneFullViewFloating) => {
      const current = latestRef.current.stored;
      if (current && current.floating !== floating) write({ ...current, floating });
    },
    [write],
  );

  return useMemo(
    () => ({ fullView, enter, exit, toggle, setSurface, setFloating }),
    [enter, exit, fullView, setFloating, setSurface, toggle],
  );
}
