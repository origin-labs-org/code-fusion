<script lang="ts">
  import type { VoicePhase, VoiceTake } from "$domain/voice";
  import { reducedMotion } from "$shared/lib/motion";

  let { take, phase }: { take: VoiceTake; phase: VoicePhase } = $props();

  /** One bar per 80 ms: a slow scroll that reads as a recording, not a meter. */
  const STEP_MS = 80;
  const PITCH = 4;
  const METER = [0.45, 0.75, 1, 0.75, 0.45];

  let width = $state(0);
  let strip = $state<HTMLElement>();
  const reduce = reducedMotion();
  const count = $derived(
    reduce ? METER.length : Math.min(160, Math.max(12, Math.floor(width / PITCH) + 1)),
  );
  let bars: HTMLElement[] = $state([]);

  /** Bars grow from a dot; quiet speech still moves them. */
  const height = (level: number) => 0.12 + 0.88 * Math.pow(Math.min(1, level / 100), 0.75);

  let history: number[] = [];
  let queue: number[] = [];

  function paint(offset = 0) {
    const shown = bars.slice(0, count);
    if (reduce) {
      const level = history.at(-1) ?? 0;
      shown.forEach((bar, at) => {
        bar.style.transform = `scaleY(${height(level * METER[at]!)})`;
      });
      return;
    }
    const start = history.length - shown.length;
    shown.forEach((bar, at) => {
      bar.style.transform = `scaleY(${height(history[start + at] ?? 0)})`;
    });
    if (strip) strip.style.transform = `translateX(${-offset * PITCH}px)`;
  }

  $effect(() => {
    const stop = take.onLevels((levels) => {
      queue.push(...levels);
      // Behind by more than half a second: drop the backlog, never lag.
      if (queue.length > 12) queue = queue.slice(-4);
      if (reduce) {
        history = [queue.at(-1) ?? 0];
        queue = [];
        paint();
      }
    });
    return stop;
  });

  $effect(() => {
    if (reduce || phase !== "listening") return;
    void count;
    let frame = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      carry += now - last;
      last = now;
      while (carry >= STEP_MS) {
        carry -= STEP_MS;
        // Two 40 ms levels per bar; the louder one shows.
        const next = Math.max(queue.shift() ?? 0, queue.shift() ?? 0);
        history.push(next);
        if (history.length > count + 1) history = history.slice(-(count + 1));
      }
      paint(carry / STEP_MS);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  });
</script>

<div
  class="wave"
  data-phase={phase}
  data-reduce={reduce}
  bind:clientWidth={width}
  aria-hidden="true"
>
  <div class="strip" bind:this={strip}>
    {#each { length: count }, at (at)}<span class="bar" bind:this={bars[at]}></span>{/each}
  </div>
</div>

<style>
  /* Time runs left to right in every script, as on a recorder. */
  .wave {
    position: relative;
    direction: ltr;
    flex: 1;
    min-inline-size: 0;
    block-size: 34px;
    overflow: hidden;

    /* The oldest speech fades out at the far edge. */
    mask-image: linear-gradient(to right, transparent, black 28%);
  }

  .strip {
    position: absolute;
    inset-block: 0;
    inset-inline-end: -4px;
    display: flex;
    align-items: center;
    gap: 2px;
    will-change: transform;
  }

  .bar {
    flex: none;
    inline-size: 2px;
    block-size: 22px;
    border-radius: 1px;
    background: var(--color-text);
    opacity: 0.88;
    transform: scaleY(0.12);
    transition: opacity var(--motion-base) var(--ease-out);
  }

  .wave[data-phase="starting"] .bar {
    opacity: 0.32;
  }

  /* The words are on their way: the trace steps back for the label. */
  .wave[data-phase="transcribing"] .bar {
    opacity: 0.08;
  }

  /* Reduced motion: a still level meter in the middle, not a scrolling trace. */
  .wave[data-reduce="true"] {
    mask-image: none;
  }

  .wave[data-reduce="true"] .strip {
    position: static;
    justify-content: center;
    block-size: 100%;
    gap: 3px;
  }

  .wave[data-reduce="true"] .bar {
    inline-size: 3px;
    border-radius: 1.5px;
  }

  @media (forced-colors: active) {
    .bar {
      background: CanvasText;
    }
  }
</style>
