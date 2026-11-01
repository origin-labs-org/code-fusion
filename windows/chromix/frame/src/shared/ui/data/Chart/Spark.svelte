<script lang="ts">
  import type { ChartSpec } from "./chart";
  import { band, barPath, linear, monotone, runs, type Point } from "./geometry";
  import type { Plan } from "./plan";
  /** A trend in a row: no axes, no readout, filling its box. */
  let {
    spec,
    shape,
    summary,
    settled,
  }: { spec: ChartSpec; shape: Plan; summary: string; settled: boolean } = $props();
  let width = $state(0);
  let height = $state(0);
  const columns = $derived(spec.x?.kind === "category");
  const values = $derived(shape.rows.map((row) => row.points[0]?.y ?? null));
  const range = $derived.by((): [number, number] => {
    if (columns) return shape.domain;
    const finite = values.filter((value): value is number => value !== null);
    return finite.length ? [Math.min(...finite), Math.max(...finite)] : [0, 1];
  });
  const y = $derived(linear(range, [height - 2, 2]));
  const x = $derived(linear([0, Math.max(1, shape.rows.length - 1)], [1, width - 1]));
  const line = $derived(
    runs(
      values.map((value, index): Point | null =>
        value === null ? null : { x: x(index), y: y(value) },
      ),
    )
      .map((piece) => monotone(piece))
      .join(""),
  );
  const bars = $derived.by(() => {
    if (!columns) return [];
    const slots = band(shape.rows.length, [0, width], 0.25, 0.1);
    const base = y(Math.max(range[0], Math.min(0, range[1])));
    return values.flatMap((value, index) => {
      if (value === null) return [];
      const top = y(value);
      const d = barPath(
        slots.start(index),
        Math.min(top, base),
        slots.width,
        Math.abs(base - top),
        Math.min(2, slots.width / 2),
        "end",
        top <= base ? "up" : "down",
      );
      return d ? [{ index, d }] : [];
    });
  });
</script>

<span class="spark" bind:clientWidth={width} bind:clientHeight={height}>
  {#if width && height}
    <svg {width} {height} role="img" aria-label={summary}>
      {#if columns}
        {#each bars as bar (bar.index)}<path
            d={bar.d}
            fill={shape.series[0]?.color}
            class="mark bar"
            class:enter={!settled}
          />{/each}
      {:else}
        <path
          d={line}
          stroke={shape.series[0]?.color}
          pathLength="1"
          class="mark line"
          class:enter={!settled}
        />
      {/if}
    </svg>
  {/if}
</span>

<style>
  .spark {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    min-block-size: 16px;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .line {
    fill: none;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .line.enter {
    stroke-dasharray: 1;
    animation: draw var(--motion-page) var(--ease-smooth) both;
  }

  .bar {
    transform-box: fill-box;
    transform-origin: bottom;
  }

  .bar.enter {
    animation: rise var(--motion-slow) var(--ease-emphasized) both;
  }

  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }

  @keyframes rise {
    from {
      transform: scaleY(0);
    }
  }
</style>
