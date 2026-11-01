<script lang="ts">
  import { onDestroy, type Snippet } from "svelte";
  import { pointText, tickLabel, xText, type ChartEvidence, type ChartSpec } from "./chart";
  import { areaPath, band, barPath, linear, monotone, runs, type Point } from "./geometry";
  import { Hover } from "./hover.svelte";
  import { readout, shortValue, type Card, type Plan, type Row } from "./plan";
  import Tip from "./Tip.svelte";
  /** Bars, stacks, ranges, lines and areas on two axes, drawn in one SVG. */
  let {
    spec,
    shape,
    labels,
    detail,
    summary,
    uid,
    height,
    settled,
    onevidence,
    glyph,
  }: {
    spec: ChartSpec;
    shape: Plan;
    labels: Card;
    detail: "full" | "overview" | "tile";
    summary: string;
    uid: string;
    height: number;
    settled: boolean;
    onevidence?: (reference: ChartEvidence) => void;
    glyph?: Snippet<[ChartEvidence]>;
  } = $props();
  /** An average glyph's advance at the caption size, for room only, never for layout of the marks. */
  const CHAR = 6.5;
  let width = $state(0);
  const hover = new Hover();
  onDestroy(() => hover.dispose());

  const quiet = $derived(detail !== "full");
  const tile = $derived(detail === "tile");
  const compact = $derived(!!spec.compact || quiet);
  const trend = $derived(spec.kind === "line" || spec.kind === "area");
  const lying = $derived(shape.horizontal);
  const banded = $derived(shape.scale === "band");
  const stacked = $derived(shape.layout === "stack");
  /** Bars that carry their own values need no value axis. */
  const valued = $derived(
    !quiet &&
      (spec.compact
        ? labels.values
        : (spec.kind === "bars" || spec.kind === "range") &&
          spec.series.length === 1 &&
          shape.rows.length <= 12),
  );
  const valueAxis = $derived(!compact && !valued);
  /** A line's points are drawn while there are few enough to tell apart. */
  const dotted = $derived(
    spec.kind === "line" && !tile && shape.rows.length <= 16 && spec.series.length <= 3,
  );

  const valueText = (row: Row, order: number) =>
    spec.compact ? shortValue(row.points[order], spec.y) : pointText(row.points[order], spec.y);
  const tickRoom = $derived(
    Math.max(24, ...shape.ticks.map((tick) => tickLabel(tick, spec.y).length * CHAR + 10)),
  );
  const nameRoom = $derived(
    Math.min(200, Math.max(...shape.rows.map((row) => row.label.length * CHAR), 0) + 12),
  );
  /** Room right of lying bars for the longest value written after one. */
  const valueRoom = $derived(
    Math.max(
      24,
      ...shape.rows.flatMap((row) =>
        row.points.map((_, order) => valueText(row, order).length * CHAR + 12),
      ),
    ),
  );
  const pad = $derived.by(() => {
    if (tile) return { top: 2, right: 2, bottom: 2, left: 2 };
    if (lying)
      return {
        top: 4,
        right: valued || labels.values ? valueRoom : 8,
        bottom: valueAxis ? 22 : 4,
        left: quiet ? 4 : nameRoom,
      };
    const labelled = spec.compact && !quiet && (labels.categories || !!labels.ends);
    // The value axis reads on the left, where a reader looks for it; a line keeps room at both ends for its dots.
    return {
      top: valued || (spec.compact && labels.values && !quiet) ? 20 : 8,
      right: spec.compact && labels.ends && !quiet ? 36 : trend ? 14 : 4,
      bottom: quiet ? 4 : spec.compact ? (labelled ? 18 : 4) : 24,
      left: valueAxis ? tickRoom : trend ? 14 : 0,
    };
  });
  const left = $derived(pad.left);
  const right = $derived(Math.max(left + 1, width - pad.right));
  const top = $derived(pad.top);
  const bottom = $derived(Math.max(top + 1, height - pad.bottom));

  /** The value axis, up the plot or across it when the bars lie down. */
  const value = $derived(
    lying ? linear(shape.domain, [left, right]) : linear(shape.domain, [bottom, top]),
  );
  const zero = $derived(value(Math.max(shape.domain[0], Math.min(0, shape.domain[1]))));
  const bands = $derived(
    band(shape.rows.length, lying ? [top, bottom] : [left, right], tile ? 0.2 : 0.28, 0.1),
  );
  const span = $derived.by((): [number, number] => {
    const ats = shape.rows.map((row) => row.at);
    return [Math.min(...ats), Math.max(...ats)];
  });
  const along = $derived(
    shape.scale === "index"
      ? linear([0, Math.max(1, shape.rows.length - 1)], [left, right])
      : linear(span, [left, right]),
  );
  /** Where a row stands across the plot: its band's middle, or its place on the axis. */
  function middle(row: Row): number {
    if (banded) return bands.start(row.index) + bands.width / 2;
    if (shape.rows.length === 1) return (left + right) / 2;
    return along(row.at);
  }

  type Bar = { key: string; d: string; color: string; origin: string; index: number };
  const radius = $derived.by(() => {
    const across = groupWidth();
    return Math.max(2, Math.min(tile ? 3 : 6, across / 2));
  });
  function groupWidth() {
    if (stacked || spec.series.length === 1) return bands.width;
    return band(spec.series.length, [0, bands.width], 0.14, 0).width;
  }
  const bars = $derived.by((): Bar[] => {
    if (trend) return [];
    const out: Bar[] = [];
    const inner = band(spec.series.length, [0, bands.width], 0.14, 0);
    spec.series.forEach((_, order) => {
      shape.rows.forEach((row) => {
        const point = row.points[order];
        if (!point || point.y === null) return;
        let from: number;
        let to: number;
        let corners: "end" | "all" | "none" = "end";
        if (stacked) {
          [from, to] = shape.stacks[order]![row.index]!;
          if (from === to) return;
          const outward = to >= from;
          const later = shape.stacks.slice(order + 1).some((spans) => {
            const [a, b] = spans[row.index]!;
            return a !== b && b >= a === outward;
          });
          if (later) corners = "none";
        } else if (spec.kind === "range") {
          from = point.y;
          to = point.y2 ?? point.y;
          corners = "all";
        } else {
          from = Math.max(shape.domain[0], Math.min(0, shape.domain[1]));
          to = point.y;
        }
        const offset = stacked || spec.series.length === 1 ? 0 : inner.start(order);
        const room = stacked || spec.series.length === 1 ? bands.width : inner.width;
        // A few bars in a wide plot stay bars, centred in their room, not slabs.
        const across = Math.min(room, lying ? 28 : 64);
        const start = bands.start(row.index) + offset + (room - across) / 2;
        let a = value(from);
        let b = value(to);
        // A range quoted as one figure is a capsule at that figure, never nothing.
        const least = Math.min(across, 8);
        if (spec.kind === "range" && Math.abs(b - a) < least) {
          const mid = (a + b) / 2;
          const half = (least / 2) * (b >= a ? 1 : -1);
          [a, b] = [mid - half, mid + half];
        }
        // Parts of a stack are parted by a 2px gap on the side away from the baseline.
        const gap = stacked && from !== 0 ? 2 : 0;
        let d: string;
        let origin: string;
        if (lying) {
          const forward = b >= a;
          const x0 = forward ? a + gap : b;
          const x1 = forward ? b : a - gap;
          d = barPath(x0, start, x1 - x0, across, radius, corners, forward ? "right" : "left");
          origin = spec.kind === "range" ? "center" : forward ? "left" : "right";
        } else {
          const upward = b <= a;
          const y0 = upward ? b : a + gap;
          const y1 = upward ? a - gap : b;
          d = barPath(start, y0, across, y1 - y0, radius, corners, upward ? "up" : "down");
          origin = spec.kind === "range" ? "center" : upward ? "bottom" : "top";
        }
        if (d)
          out.push({
            key: `${order}:${row.key}`,
            d,
            color: shape.series[order]!.color,
            origin,
            index: row.index,
          });
      });
    });
    return out;
  });

  /** Each series' points along the plot: its top on a stack, nothing at a gap. */
  const lines = $derived.by(() => {
    if (!trend) return [];
    return shape.series.map((series, order) => {
      const tops = shape.rows.map((row): Point | null => {
        const y = row.points[order]?.y;
        if (y === null || y === undefined) return null;
        return { x: middle(row), y: value(stacked ? shape.stacks[order]![row.index]![1] : y) };
      });
      const floors = shape.rows.map((row): Point | null =>
        stacked
          ? { x: middle(row), y: value(shape.stacks[order]![row.index]![0]) }
          : { x: middle(row), y: zero },
      );
      const pieces = runs(
        tops.map((point, index) => (point ? { point, floor: floors[index]! } : null)),
      );
      return {
        key: series.key,
        color: series.color,
        line: pieces.map((piece) => monotone(piece.map((entry) => entry.point))).join(""),
        area: pieces
          .map((piece) =>
            areaPath(
              piece.map((entry) => entry.point),
              piece.map((entry) => entry.floor!),
            ),
          )
          .join(""),
        dots: tops,
      };
    });
  });

  /** Category names along their axis, thinned evenly so no two ever touch. */
  const shown = $derived.by(() => {
    if (lying) return shape.rows;
    if (shape.scale === "index") {
      const every = Math.max(1, Math.ceil(shape.rows.length / 8));
      return shape.rows.filter((row) => row.index % every === 0);
    }
    const widest = Math.max(...shape.rows.map((row) => category(row).length * CHAR), 0) + 10;
    const room = Math.max(1, right - left);
    const every = Math.max(1, Math.ceil((shape.rows.length * widest) / room));
    return shape.rows.filter((_, index) => index % every === 0);
  });
  const timeFormat = $derived(
    new Intl.DateTimeFormat(
      undefined,
      span[1] - span[0] > 2 * 86_400_000
        ? { month: "short", day: "numeric" }
        : { hour: "numeric", minute: "2-digit" },
    ),
  );
  function category(row: Row): string {
    if (shape.scale === "time") return timeFormat.format(row.at);
    if (shape.scale === "linear") return xText(row.at, "linear");
    return row.label;
  }
  /** A name cut to the room beside lying bars, whole in its title. */
  function fit(text: string, room: number) {
    const most = Math.max(3, Math.floor(room / CHAR));
    return text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text;
  }
  /** Where a bar's value is written, in plot pixels. */
  function spot(row: Row, order: number) {
    const point = row.points[order];
    if (!point || point.y === null) return null;
    const end = point.y2 ?? point.y;
    const up = end >= 0;
    const many = spec.series.length > 1 && !stacked;
    const inner = band(spec.series.length, [0, bands.width], 0.14, 0);
    const offset = many ? inner.start(order) + inner.width / 2 : bands.width / 2;
    if (lying)
      return {
        x: value(end) + (up ? 6 : -6),
        y: bands.start(row.index) + offset,
        anchor: up ? ("start" as const) : ("end" as const),
      };
    return {
      x: bands.start(row.index) + offset,
      y: value(end) + (up ? -7 : 14),
      anchor: "middle" as const,
    };
  }
  const lastRow = $derived(shape.rows.findLast((row) => row.points[0] && row.points[0].y !== null));

  function locate(event: PointerEvent) {
    const box = (event.currentTarget as SVGElement).getBoundingClientRect();
    const position = lying ? event.clientY - box.top : event.clientX - box.left;
    let index: number;
    if (banded) {
      index = Math.floor((position - bands.start(0) + (bands.step - bands.width) / 2) / bands.step);
    } else {
      let best = 0;
      let distance = Infinity;
      for (const row of shape.rows) {
        const gap = Math.abs(middle(row) - position);
        if (gap < distance) [best, distance] = [row.index, gap];
      }
      index = best;
    }
    hover.show(Math.max(0, Math.min(shape.rows.length - 1, index)));
  }
  const active = $derived(hover.index === null ? null : (shape.rows[hover.index] ?? null));
  const tip = $derived(active ? readout(spec, shape, active.index) : null);
  /** The readout stands over the furthest value at the hovered row. */
  const anchor = $derived.by(() => {
    if (!active) return null;
    const ends = active.points.flatMap((point, order) => {
      if (!point || point.y === null) return [];
      if (stacked) return [shape.stacks[order]![active.index]![1]];
      return [point.y2 ?? point.y];
    });
    const most = ends.length ? Math.max(...ends) : 0;
    if (lying) return { x: value(most), y: bands.start(active.index) };
    return { x: middle(active), y: Math.min(value(most), bottom) - (trend ? 4 : 0) };
  });
</script>

<div class="cartesian" bind:clientWidth={width} style:block-size={`${height}px`}>
  {#if width}
    <svg
      {width}
      {height}
      role="img"
      aria-label={summary}
      class:lying
      onpointermove={quiet ? undefined : locate}
      onpointerleave={quiet ? undefined : () => hover.hide()}
    >
      {#if spec.kind === "area"}
        <defs>
          {#each shape.series as series, order (series.key)}
            <linearGradient id={`${uid}-wash-${order}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color={series.color} stop-opacity={tile ? 0.5 : 0.36} />
              <stop offset="100%" stop-color={series.color} stop-opacity="0.02" />
            </linearGradient>
          {/each}
        </defs>
      {/if}
      {#if !tile && !(lying && valued)}
        <g class="grid" aria-hidden="true">
          {#each shape.ticks as tick (tick)}
            {@const at = Math.round(value(tick)) + 0.5}
            {#if lying}<line x1={at} x2={at} y1={top} y2={bottom} />{:else}<line
                x1={left}
                x2={right}
                y1={at}
                y2={at}
              />{/if}
          {/each}
        </g>
      {/if}
      {#if shape.domain[0] < 0 && shape.domain[1] > 0}
        {@const at = Math.round(zero) + 0.5}
        {#if lying}<line class="zero" x1={at} x2={at} y1={top} y2={bottom} />{:else}<line
            class="zero"
            x1={left}
            x2={right}
            y1={at}
            y2={at}
          />{/if}
      {/if}
      {#if active && banded}
        {@const start = bands.start(active.index) - (bands.step - bands.width) / 2}
        {#if lying}<rect
            class="cursor"
            x={left}
            y={start}
            width={right - left}
            height={bands.step}
            rx="6"
          />{:else}<rect
            class="cursor"
            x={start}
            y={top}
            width={bands.step}
            height={bottom - top}
            rx="6"
          />{/if}
      {/if}
      {#if trend}
        {#each lines as series, order (series.key)}
          {#if spec.kind === "area"}<path
              d={series.area}
              class="mark area"
              class:enter={!settled}
              fill={`url(#${uid}-wash-${order})`}
            />{/if}
          <path
            d={series.line}
            class="mark line"
            class:enter={!settled}
            stroke={series.color}
            pathLength="1"
          />
          {#if dotted}
            {#each series.dots as dot, index (index)}
              {#if dot}<circle
                  cx={dot.x}
                  cy={dot.y}
                  r="3.5"
                  class="mark dot"
                  class:enter={!settled}
                  fill={series.color}
                />{/if}
            {/each}
          {/if}
        {/each}
        {#if active && !quiet}
          {@const x = middle(active)}
          <line class="cursor-line" x1={x} x2={x} y1={top} y2={bottom} />
          {#each lines as series (series.key)}
            {@const dot = series.dots[active.index]}
            {#if dot}<circle cx={dot.x} cy={dot.y} r="4.5" class="focus" fill={series.color} />{/if}
          {/each}
        {/if}
      {:else}
        {#each bars as bar (bar.key)}
          <path
            d={bar.d}
            fill={bar.color}
            class="mark bar"
            class:enter={!settled}
            class:dim={active !== null && active.index !== bar.index}
            style:transform-origin={bar.origin}
            style:animation-delay={settled ? undefined : `${Math.min(bar.index * 18, 180)}ms`}
          />
        {/each}
        {#if valued}
          {#each shape.series as series, order (series.key)}
            {#each shape.rows as row (row.key)}
              {@const at = spot(row, order)}
              {#if at}<text
                  x={at.x}
                  y={at.y}
                  text-anchor={at.anchor}
                  dominant-baseline={lying ? "central" : "auto"}
                  class="value"
                  class:enter={!settled}>{valueText(row, order)}</text
                >{/if}
            {/each}
          {/each}
        {/if}
      {/if}
      {#if valueAxis}
        <g class="axis" aria-hidden="true">
          {#each shape.ticks as tick (tick)}
            {#if lying}<text class="tick" x={value(tick)} y={bottom + 16} text-anchor="middle"
                >{tickLabel(tick, spec.y)}</text
              >{:else}<text
                class="tick"
                x={left - 8}
                y={value(tick)}
                text-anchor="end"
                dominant-baseline="central">{tickLabel(tick, spec.y)}</text
              >{/if}
          {/each}
        </g>
      {/if}
      {#if !quiet && (!compact || labels.categories)}
        <g class="axis" aria-hidden="true">
          {#each shown as row (row.key)}
            {#if lying}<text
                class="tick name"
                x={left - 8}
                y={bands.start(row.index) + bands.width / 2}
                text-anchor="end"
                dominant-baseline="central"
                ><title>{row.label}</title>{fit(row.label, nameRoom - 12)}</text
              >{:else}<text
                class="tick"
                class:on={active?.index === row.index}
                x={middle(row)}
                y={bottom + 16}
                text-anchor={!banded && row.index === 0 && shape.rows.length > 1
                  ? "start"
                  : !banded && row.index === shape.rows.length - 1 && shape.rows.length > 1
                    ? "end"
                    : "middle"}>{category(row)}</text
              >{/if}
          {/each}
        </g>
      {:else if !quiet && labels.ends}
        {@const first = shape.rows[0]}
        {@const last = shape.rows.at(-1)}
        <g class="axis" aria-hidden="true">
          {#if first}<text class="tick" x={middle(first)} y={bottom + 14} text-anchor="start"
              >{category(first)}</text
            >{/if}
          {#if last && last !== first}<text
              class="tick"
              x={middle(last)}
              y={bottom + 14}
              text-anchor="end">{category(last)}</text
            >{/if}
        </g>
        {#if lastRow}
          {@const end = lines[0]?.dots[lastRow.index]}
          {#if end}<text
              class="value end"
              x={end.x + 6}
              y={end.y}
              dominant-baseline="central"
              text-anchor="start">{labels.ends.value}</text
            >{/if}
        {/if}
      {/if}
    </svg>
    {#if tip && anchor && !quiet}<Tip
        readout={tip}
        x={anchor.x}
        y={anchor.y}
        {width}
        {hover}
        indicator={trend ? "line" : "dot"}
        {onevidence}
        {glyph}
      />{/if}
  {/if}
</div>

<style>
  .cartesian {
    position: relative;
    inline-size: 100%;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .grid line {
    stroke: var(--color-border);
    stroke-dasharray: 3 3;
    shape-rendering: crispedges;
  }

  .zero {
    stroke: var(--color-border-strong);
    shape-rendering: crispedges;
  }

  .cursor {
    fill: var(--color-fill);
  }

  .cursor-line {
    stroke: var(--color-border-strong);
    shape-rendering: crispedges;
  }

  .focus {
    stroke: var(--color-surface);
    stroke-width: 2;
  }

  .tick {
    fill: var(--color-muted);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
    transition: fill var(--motion-fast) var(--ease-out);
  }

  .tick.on {
    fill: var(--color-text);
  }

  .value {
    fill: var(--color-label-secondary);
    font-size: var(--text-caption);
    font-weight: 550;
    font-variant-numeric: tabular-nums;
  }

  .bar {
    transform-box: fill-box;
    transition: opacity var(--motion-fast) var(--ease-out);
  }

  .bar.dim {
    opacity: 0.55;
  }

  .line {
    fill: none;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  :global(.tile) .line {
    stroke-width: 2.5;
  }

  .dot {
    stroke: var(--color-surface);
    stroke-width: 1.5;
  }

  /* A chart arrives once: bars rise from their baseline, lines draw in, washes and words follow. */
  .bar.enter {
    animation: rise var(--motion-slow) var(--ease-emphasized) both;
  }

  .line.enter {
    stroke-dasharray: 1;
    animation: draw var(--motion-page) var(--ease-smooth) both;
  }

  .area.enter,
  .dot.enter,
  .value.enter {
    animation: fade var(--motion-slow) var(--ease-out) both;
  }

  .dot.enter,
  .value.enter {
    animation-delay: var(--motion-base);
  }

  .lying .bar.enter {
    animation-name: reach;
  }

  @keyframes rise {
    from {
      transform: scaleY(0);
    }
  }

  @keyframes reach {
    from {
      transform: scaleX(0);
    }
  }

  @keyframes draw {
    from {
      stroke-dashoffset: 1;
    }
  }

  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
