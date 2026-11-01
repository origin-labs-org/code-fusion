/** What woke the page while nobody touched it. */
export type Wakeups = {
  /** Animation frame callbacks that ran. */
  frames: number;
  /** Timeout and interval callbacks that ran. */
  timers: number;
  /** CSS and Web animations still running at the end. */
  animations: string[];
  /** Where the callbacks were asked for, most frequent first. */
  sites: [string, number][];
};

const site = () =>
  (new Error().stack ?? "")
    .split("\n")
    .slice(3, 5)
    .map((line) =>
      line
        .trim()
        .replace(/https?:\/\/[^/]+/gu, "")
        .replace(/\?[^:]*:/gu, ":"),
    )
    .join(" < ");

/**
 * Counts every animation frame and timer callback the page runs from now on,
 * including intervals started before a measurement; `rest(ms)` reports what
 * ran during that much rest and the animations left running. A page at rest
 * should report none: each one is a wake the battery pays for. Install before
 * rendering, and `restore()` after.
 */
export function wakeupCounter() {
  type Schedule = (handler: TimerHandler, delay?: number, ...rest: unknown[]) => number;
  const raf = window.requestAnimationFrame;
  const timeout = window.setTimeout as unknown as Schedule;
  const interval = window.setInterval as unknown as Schedule;
  let counting = false;
  const counts = new Map<string, number>();
  let frames = 0;
  let timers = 0;
  const counted = (kind: "frame" | "timer", from: string, callback: TimerHandler) =>
    typeof callback !== "function"
      ? callback
      : (...args: unknown[]) => {
          if (counting) {
            if (kind === "frame") frames += 1;
            else timers += 1;
            counts.set(from, (counts.get(from) ?? 0) + 1);
          }
          (callback as (...a: unknown[]) => void)(...args);
        };
  window.requestAnimationFrame = (callback) =>
    raf.call(window, counted("frame", site(), callback) as FrameRequestCallback);
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...rest: unknown[]) =>
    timeout.call(
      window,
      counted("timer", site(), callback),
      delay,
      ...rest,
    )) as unknown as typeof window.setTimeout;
  window.setInterval = ((callback: TimerHandler, delay?: number, ...rest: unknown[]) =>
    interval.call(
      window,
      counted("timer", site(), callback),
      delay,
      ...rest,
    )) as unknown as typeof window.setInterval;
  return {
    async rest(ms = 2000): Promise<Wakeups> {
      counts.clear();
      frames = 0;
      timers = 0;
      counting = true;
      await new Promise((done) => timeout.call(window, done, ms));
      counting = false;
      const animations = document
        .getAnimations()
        // A scroll-driven animation moves only when its scroller does; on the
        // document clock is what ticks at rest.
        .filter(
          (animation) =>
            animation.playState === "running" && animation.timeline === document.timeline,
        )
        .map((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          const name =
            "animationName" in animation
              ? String((animation as CSSAnimation).animationName)
              : animation.id;
          return `${name || "animation"} on ${target?.localName ?? "?"}.${[...(target?.classList ?? [])].join(".")}`;
        });
      return { frames, timers, animations, sites: [...counts].sort((a, b) => b[1] - a[1]) };
    },
    restore() {
      window.requestAnimationFrame = raf;
      window.setTimeout = timeout as unknown as typeof window.setTimeout;
      window.setInterval = interval as unknown as typeof window.setInterval;
    },
  };
}
