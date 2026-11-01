import { useCallback, useEffect, useRef, useState } from "react";

export const MODEL_PROVIDER_TEXT_IDLE_TRIGGER_MS = 1_200;

export function useIdleTrigger<TResult>(
  action: () => TResult | Promise<TResult>,
  delayMs = MODEL_PROVIDER_TEXT_IDLE_TRIGGER_MS,
) {
  const actionRef = useRef(action);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scheduled, setScheduled] = useState(false);
  actionRef.current = action;

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setScheduled(false);
  }, []);

  const flush = useCallback(async (): Promise<TResult> => {
    cancel();
    return actionRef.current();
  }, [cancel]);

  const schedule = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setScheduled(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setScheduled(false);
      try {
        void Promise.resolve(actionRef.current()).catch(() => undefined);
      } catch {
      }
    }, delayMs);
  }, [delayMs]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    },
    [],
  );

  return { cancel, flush, schedule, scheduled } as const;
}
