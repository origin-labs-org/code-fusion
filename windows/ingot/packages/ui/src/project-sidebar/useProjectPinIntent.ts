import { useCallback, useMemo, useRef, useState } from "react";
import type { ProjectTask, ProjectTree } from "@/project-sidebar/contract.js";
import { buildTaskEntityKey } from "@/lib/taskQueryCache.js";

export function useProjectPinIntent(tree: ProjectTree) {
  const inFlight = useRef(new Set<string>());
  const [intents, setIntents] = useState<Record<string, boolean>>({});
  const remove = useCallback((key: string) => {
    inFlight.current.delete(key);
    setIntents((previous) => {
      const { [key]: _done, ...rest } = previous;
      return rest;
    });
  }, []);
  const pin = useCallback(
    async (task: ProjectTask, pinned: boolean, commit: () => Promise<unknown>) => {
      const key = buildTaskEntityKey(task);
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setIntents((previous) => ({ ...previous, [key]: pinned }));
      try {
        await commit();
      } finally {
        remove(key);
      }
    },
    [remove],
  );
  const displayed = useMemo(
    () =>
      Object.keys(intents).length
        ? {
            ...tree,
            tasks: tree.tasks.map((task) => {
              const intent = intents[buildTaskEntityKey(task)];
              return intent !== undefined && task.pinned !== intent
                ? { ...task, pinned: intent }
                : task;
            }),
          }
        : tree,
    [tree, intents],
  );
  return { tree: displayed, pin };
}
