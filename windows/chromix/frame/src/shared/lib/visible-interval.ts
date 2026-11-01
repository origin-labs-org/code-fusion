/**
 * Calls `tick` every `ms` while the document is visible, and once on the
 * way back when it was hidden: a hidden window wakes for nothing, and what it
 * shows is caught up the moment it is seen. Returns the stop.
 */
export function everyWhileVisible(ms: number, tick: () => void): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;
  const pace = () => {
    clearInterval(timer);
    timer = undefined;
    if (document.visibilityState === "hidden") return;
    timer = setInterval(tick, ms);
  };
  const shown = () => {
    if (document.visibilityState === "visible") tick();
    pace();
  };
  pace();
  document.addEventListener("visibilitychange", shown);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", shown);
  };
}
