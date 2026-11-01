import { useEffect, useState } from "react";

export function useBrowserUseOperationActive(operationUntil = 0): boolean {
  const [expiredOperationUntil, setExpiredOperationUntil] = useState(0);
  const isActive = operationUntil > Date.now() && expiredOperationUntil !== operationUntil;

  useEffect(() => {
    const remainingMs = operationUntil - Date.now();
    if (remainingMs <= 0) return;
    const timer = window.setTimeout(() => setExpiredOperationUntil(operationUntil), remainingMs);
    return () => window.clearTimeout(timer);
  }, [operationUntil]);

  return isActive;
}
