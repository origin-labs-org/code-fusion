<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { ChartEvidence, ChartSpec } from "./chart";
  import { band } from "./geometry";
  import { Hover } from "./hover.svelte";
  import { readout, type Plan } from "./plan";
  import Tip from "./Tip.svelte";
  /** Two categorical axes and one magnitude: a cell per series and category on one tone ramp. */
  let {
    spec,
    shape,
    height,
    compact,
    quiet,
    summary,
    settled,
    onevidence,
    glyph,
  }: {
    spec: ChartSpec;
    shape: Plan;
    height: number;
    compact: boolean;
    quiet: boolean;
    summary: string;
    settled: boolean;
    onevidence?: (reference: ChartEvidence) => void;
    glyph?: Snippet<[ChartEvidence]>;
  } = $props();
  const CHAR = 6.5;
  let width = $state(0);
  const hover = new Hover();
  onDestroy(() => hover.dispose());
  const left = $derived(
    compact ? 0 : Math.max(...spec.series.map((series) => series.name.length * CHAR), 0) + 14,
  );
  const bottom = $derived(height - (compact ? 0 : 20));
  const across = $derived(band(shape.keys.length, [left, Math.max(left + 1, width)], 0.08, 0));
  const down = $derived(band(spec.series.length, [compact ? 0 : 4, bottom], 0.1, 0));
  const tint = (tone: number | null) =>
    tone === null
      ? "var(--color-fill)"
      : `color-mix(in oklab, var(--color-lit) ${Math.round(6 + tone * 94)}%, var(--color-surface))`;
  /** Hour labels thinned evenly so no two touch. */
  const every = $derived(
    Math.max(
      1,
      Math.ceil(
        (shape.rows.length *
          (Math.max(...shape.rows.map((row) => row.label.length), 0) * CHAR + 8)) /
          Math.max(1, width - left),
      ),
    ),
  );
  const tip = $derived(hover.index === null ? null : readout(spec, shape, hover.index));
  const anchor = $derived.by(() => {
    const cell = hover.index === null ? null : shape.cells[hover.index];
    if (!cell) return null;
    const column = shape.keys.indexOf(cell.key);
    return { x: across.start(column) + across.width / 2, y: down.start(Number(cell.order)) };
  });
</script>

<div class="heat" bind:clientWidth={width} style:block-size={`${height}px`}>
  {#if width}
    <svg {width} {height} role="img" aria-label={summary}>
      {#each shape.cells as cell (cell.index)}
        <rect
          x={across.start(shape.keys.indexOf(cell.key))}
          y={down.start(Number(cell.order))}
          width={across.width}
          height={down.width}
          rx="2"
          fill={tint(cell.tone)}
          class="mark cell"
          class:enter={!settled}
          class:on={hover.index === cell.index}
          role="presentation"
          onpointerenter={quiet ? undefined : () => hover.show(cell.index)}
          onpointerleave={quiet ? undefined : () => hover.hide()}
        />
      {/each}
      {#if !compact}
        <g aria-hidden="true">
          {#each spec.series as series, order (order)}
            <text
              class="tick"
              x={left - 8}
              y={down.start(order) + down.width / 2}
              text-anchor="end"
              dominant-baseline="central">{series.name}</text
            >
          {/each}
          {#each shape.rows as row (row.key)}
            {#if row.index % every === 0}<text
                class="tick"
                x={across.start(row.index) + across.width / 2}
                y={height - 4}
                text-anchor="middle">{row.label}</text
              >{/if}
          {/each}
        </g>
      {/if}
    </svg>
    {#if tip && anchor && !quiet}<Tip
        readout={tip}
        x={anchor.x}
        y={anchor.y}
        {width}
        {hover}
        {onevidence}
        {glyph}
      />{/if}
  {/if}
</div>

<style>
  .heat {
    position: relative;
    inline-size: 100%;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .cell.on {
    stroke: var(--color-text);
    stroke-width: 1.5;
  }

  .cell.enter {
    animation: fade var(--motion-slow) var(--ease-out) both;
  }

  .tick {
    fill: var(--color-muted);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
