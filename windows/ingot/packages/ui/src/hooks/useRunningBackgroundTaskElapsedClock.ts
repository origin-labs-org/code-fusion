import { useEffect, useState } from "react";

export function useRunningBackgroundTaskElapsedClock(runningTaskCount: number) {
  const [now, setNow] = useState(() => Date.now());
  const hasRunningTasks = runningTaskCount > 0;

  useEffect(() => {
    if (!hasRunningTasks) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [hasRunningTasks]);

  return now;
}
