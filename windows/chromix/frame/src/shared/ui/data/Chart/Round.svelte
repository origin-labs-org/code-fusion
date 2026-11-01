<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import type { ChartEvidence, ChartSpec } from "./chart";
  import { arcPath, polar, sectorPath } from "./geometry";
  import { Hover } from "./hover.svelte";
  import { readout, ringTop, type Plan } from "./plan";
  import Tip from "./Tip.svelte";
  /** A donut's shares of one whole, or a radial chart's rings toward a top. */
  let {
    spec,
    shape,
    size,
    detail,
    summary,
    settled,
    middle,
    onevidence,
    glyph,
  }: {
    spec: ChartSpec;
    shape: Plan;
    size: number;
    detail: "full" | "overview" | "tile";
    summary: string;
    settled: boolean;
    /** What the middle says: a share, the headline or the total. */
    middle: { value: string; label: string } | null;
    onevidence?: (reference: ChartEvidence) => void;
    glyph?: Snippet<[ChartEvidence]>;
  } = $props();
  const hover = new Hover();
  onDestroy(() => hover.dispose());
  const quiet = $derived(detail !== "full");
  const tile = $derived(detail === "tile");
  const centre = $derived(size / 2);
  const outer = $derived(Math.max(8, size / 2 - 2));
  const TURN = Math.PI * 2;

  /** Slices clockwise from twelve o'clock, parted by a hair's gap when there are several. */
  const slices = $derived.by(() => {
    if (spec.kind !== "donut" || !shape.total) return [];
    const inner = outer * (tile ? 0.6 : 0.7);
    const gap = shape.parts.length > 1 ? 0.025 : 0;
    const corner = tile ? 1.5 : 3;
    let angle = 0;
    return shape.parts.map((part) => {
      const sweep = (part.value / shape.total) * TURN;
      const from = angle + gap / 2;
      const to = angle + sweep - gap / 2;
      angle += sweep;
      return {
        part,
        d: sectorPath(centre, centre, inner, outer, from, Math.max(from, to), corner),
        corner,
        tip: polar(centre, centre, outer, (from + to) / 2),
      };
    });
  });

  const top = $derived(spec.kind === "radial" ? ringTop(spec, shape.parts) : 1);
  /** Rings outermost first, each a round-capped arc over its track. */
  const rings = $derived.by(() => {
    if (spec.kind !== "radial") return [];
    const count = Math.max(1, shape.parts.length);
    const inner = outer * (count === 1 ? 0.72 : 0.36);
    const step = (outer - inner) / count;
    const thickness = Math.max(3, step * (count === 1 ? 1 : 0.72));
    return shape.parts.map((part) => {
      const radius = outer - part.index * step - thickness / 2;
      const share = Math.min(1, Math.max(0, part.value / (top || 1)));
      return {
        part,
        radius,
        thickness,
        d: share > 0 ? arcPath(centre, centre, radius, 0, share * TURN) : "",
        tip: polar(centre, centre, radius, share * TURN),
      };
    });
  });

  const tip = $derived(hover.index === null ? null : readout(spec, shape, hover.index));
  const anchor = $derived.by(() => {
    if (hover.index === null) return null;
    const found =
      slices.find((slice) => slice.part.index === hover.index) ??
      rings.find((ring) => ring.part.index === hover.index);
    return found?.tip ?? null;
  });
  const enter = (index: number) => (!quiet ? () => hover.show(index) : undefined);
  const leave = $derived(quiet ? undefined : () => hover.hide());
</script>

<div class="round" style:inline-size={`${size}px`} style:block-size={`${size}px`}>
  <svg width={size} height={size} role="img" aria-label={summary}>
    <g class="ring" class:enter={!settled && spec.kind === "donut"}>
      {#each slices as slice (slice.part.index)}
        <path
          d={slice.d}
          fill={slice.part.color}
          stroke={slice.part.color}
          stroke-width={slice.corner * 2}
          class="mark slice"
          class:dim={hover.index !== null && hover.index !== slice.part.index}
          role="presentation"
          onpointerenter={enter(slice.part.index)}
          onpointerleave={leave}
        />
      {/each}
      {#each rings as ring (ring.part.index)}
        <circle
          cx={centre}
          cy={centre}
          r={ring.radius}
          class="track"
          stroke-width={ring.thickness}
        />
        {#if ring.d}<path
            d={ring.d}
            stroke={ring.part.color}
            stroke-width={ring.thickness}
            pathLength="1"
            class="mark slice arc"
            class:draw={!settled}
            class:dim={hover.index !== null && hover.index !== ring.part.index}
            role="presentation"
            onpointerenter={enter(ring.part.index)}
            onpointerleave={leave}
          />{/if}
      {/each}
    </g>
    {#if middle && !tile && (spec.kind === "donut" || shape.parts.length === 1)}
      <text
        x={centre}
        y={centre + (detail === "full" ? -2 : 0)}
        text-anchor="middle"
        dominant-baseline="central"
        class="total">{middle.value}</text
      >
      {#if detail === "full"}<text
          x={centre}
          y={centre + (spec.compact ? 14 : 18)}
          text-anchor="middle"
          dominant-baseline="central"
          class="caption-text"
          class:lead={spec.compact}>{middle.label}</text
        >{/if}
    {/if}
  </svg>
  {#if tip && anchor}<Tip
      readout={tip}
      x={anchor.x}
      y={anchor.y}
      width={size}
      {hover}
      {onevidence}
      {glyph}
    />{/if}
</div>

<style>
  .round {
    position: relative;
    flex: none;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .slice {
    stroke-linejoin: round;
    transition: opacity var(--motion-fast) var(--ease-smooth);
  }

  .arc {
    fill: none;
    stroke-linecap: round;
  }

  .slice.dim {
    opacity: 0.4;
  }

  .track {
    fill: none;
    stroke: var(--color-fill);
  }

  .total {
    fill: var(--color-text);
    font-size: var(--text-title);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
  }

  :global(.compact) .total {
    font-size: var(--text-body);
    font-weight: 600;
  }

  :global(.overview) .total {
    font-size: var(--text-overview-figure);
  }

  .caption-text {
    fill: var(--color-muted);
    font-size: var(--text-caption);
  }

  :global(.overview) .caption-text {
    font-size: var(--text-overview-label);
  }

  /* The ring turns a few degrees into place as it fades in; rings draw along their arc. */
  .ring.enter {
    transform-box: view-box;
    transform-origin: center;
    animation: settle var(--motion-page) var(--ease-emphasized) both;
  }

  .arc.draw {
    stroke-dasharray: 1;
    animation: draw var(--motion-page) var(--ease-emphasized) both;
  }

  @keyframes settle {
    from {
      opacity: 0;
      transform: rotate(-12deg) scale(0.96);
    }
  }

  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }
</style>
