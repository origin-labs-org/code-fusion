const PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS = 10_000;

let cleanupTimer: ReturnType<typeof window.setInterval> | undefined;

export function startPerformanceTimelineCleanup(): void {
  if (!import.meta.env.DEV || cleanupTimer != null) {
    return;
  }

  cleanupTimer = window.setInterval(() => {
    window.performance.clearMeasures();
    window.performance.clearMarks();
  }, PERFORMANCE_TIMELINE_CLEANUP_INTERVAL_MS);
}
