export interface E2ERunnerFinalizationGuard {
  arm(): void;
  disarm(): void;
  isArmed(): boolean;
}

export function createE2ERunnerFinalizationGuard(options: {
  onTimeout: () => void;
  timeoutMs: number;
}): E2ERunnerFinalizationGuard {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    arm() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        options.onTimeout();
      }, options.timeoutMs);
    },
    disarm() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
    isArmed() {
      return timer !== null;
    },
  };
}
