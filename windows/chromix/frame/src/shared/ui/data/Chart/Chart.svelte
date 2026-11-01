<script lang="ts">
  import type { Snippet } from "svelte";
  import { duration, reducedMotion } from "$shared/lib/motion";
  import * as m from "$shared/i18n/messages";
  import Cartesian from "./Cartesian.svelte";
  import ChartLegend from "./ChartLegend.svelte";
  import Heat from "./Heat.svelte";
  import Radar from "./Radar.svelte";
  import Round from "./Round.svelte";
  import Spark from "./Spark.svelte";
  import {
    extremes,
    formatValue,
    pointText,
    type ChartEvidence,
    type ChartKind,
    type ChartSpec,
  } from "./chart";
  import { card, legendRule, plan, valuesCsv } from "./plan";
  let {
    spec,
    title,
    height,
    detail = "full",
    onevidence,
    glyph,
  }: {
    spec: ChartSpec;
    /** Names the chart for assistive technology and captions the values table. */
    title: string;
    /** A spark's or a tile's height; without it they fill their container. */
    height?: number;
    /**
     * `full` reads every value; `overview` keeps the headline and the marks, with no
     * text too small to read from afar; `tile` is the marks alone.
     */
    detail?: "full" | "overview" | "tile";
    onevidence?: (reference: ChartEvidence) => void;
    /** A source's mark in the tooltip, drawn by the owner (a favicon); a letter otherwise. */
    glyph?: Snippet<[ChartEvidence]>;
  } = $props();
  const KINDS: Record<ChartKind, () => string> = {
    bars: m.chart_kind_bars,
    stacked: m.chart_kind_stacked,
    line: m.chart_kind_line,
    area: m.chart_kind_area,
    range: m.chart_kind_range,
    donut: m.chart_kind_donut,
    radial: m.chart_kind_radial,
    radar: m.chart_kind_radar,
    heat: m.chart_kind_heat,
    spark: m.chart_kind_spark,
  };
  const uid = $props.id();
  // A chart arrives once; reduced motion draws it settled.
  let settled = $state(reducedMotion());
  $effect(() => {
    if (settled) return;
    const timer = setTimeout(() => (settled = true), duration("page") + 240);
    return () => clearTimeout(timer);
  });

  const spark = $derived(spec.kind === "spark");
  /** Text a reader could not make out at this size is not drawn at all. */
  const quiet = $derived(detail !== "full");
  const tile = $derived(detail === "tile");
  const compact = $derived(!!spec.compact || spark || quiet);
  const shape = $derived(plan(spec, m.chart_other()));
  const labels = $derived(card(spec, shape));
  const usable = $derived(
    spec.series.some((series) => series.points.some((point) => point.y !== null)),
  );
  const round = $derived(spec.kind === "donut" || spec.kind === "radial");
  const lying = $derived(shape.horizontal);
  const shares = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 0 });
  const legend = $derived.by(() => {
    if (spark || spec.kind === "heat" || quiet) return [];
    if (round)
      return spec.compact
        ? []
        : shape.parts.map((part) => ({
            key: `p${part.index}`,
            label: part.label,
            color: part.color,
            share:
              spec.kind === "donut"
                ? shape.total
                  ? shares.format(part.value / shape.total)
                  : ""
                : pointText(part.points[0], spec.y),
          }));
    const rule = spec.compact ? labels.legend : legendRule(spec.series.length, false);
    return rule === "rows" ? shape.series : [];
  });
  const table = $derived(
    !spark && !quiet && spec.values !== false && (!spec.compact || labels.legend === "table"),
  );
  const range = $derived(extremes(spec));
  const reading = $derived(
    range
      ? m.chart_extremes({ low: m.chart_extreme(range.low), high: m.chart_extreme(range.high) })
      : "",
  );
  const summary = $derived.by(() => {
    const axes = [spec.x?.label, spec.y?.label].filter((part) => !!part?.trim()).join("; ");
    return [title, axes, `${KINDS[spec.kind]()}${reading ? `; ${reading}` : ""}`]
      .filter(Boolean)
      .join(". ");
  });
  const exact = $derived(
    spec.series.some((series) => series.points.some((point) => point.display !== undefined)),
  );
  const cited = $derived(
    spec.series.some((series) => series.points.some((point) => point.evidence?.length)),
  );
  /** The one figure the chart exists to say: the spec's own, or a round chart's total. */
  const headline = $derived(spec.headline);
  const rowHeight = $derived(compact ? 20 : Math.max(24, 10 + spec.series.length * 12));
  const plotHeight = $derived.by(() => {
    if (tile && height) return height;
    if (spec.kind === "heat")
      return (
        (compact ? 0 : 24) +
        spec.series.length *
          (compact ? Math.max(6, Math.floor(132 / Math.max(1, spec.series.length))) : 20)
      );
    if (round) return tile ? 150 : detail === "overview" ? 260 : spec.compact ? 132 : 188;
    if (spec.kind === "radar") return tile ? 150 : detail === "overview" ? 260 : 280;
    if (lying) return (compact ? 8 : 30) + shape.rows.length * rowHeight;
    if (tile) return 96;
    return detail === "overview" ? 200 : spec.compact ? 132 : 220;
  });
  /** What a round chart says in its middle: the headline, else the total or the one value. */
  const middle = $derived.by(() => {
    if (spec.compact && labels.lead) return { value: labels.lead.share, label: labels.lead.label };
    if (headline) return headline;
    if (spec.kind === "radial") {
      const first = shape.parts[0];
      return first ? { value: pointText(first.points[0], spec.y), label: first.label } : null;
    }
    return { value: formatValue(shape.total, spec.y), label: m.chart_total() };
  });

  let copied = $state(false);
  function copy() {
    void navigator.clipboard.writeText(valuesCsv(spec)).then(
      () => {
        copied = true;
        setTimeout(() => (copied = false), 1600);
      },
      () => (copied = false),
    );
  }
</script>

{#if spark}
  <span class="spark-box" style:block-size={height ? `${height}px` : undefined}>
    {#if usable}<Spark {spec} {shape} {summary} {settled} />{/if}
  </span>
{:else}
  <figure
    class="chart {detail}"
    class:compact={spec.compact}
    class:round
    class:radar={spec.kind === "radar"}
  >
    {#if headline && !tile && (!round || (spec.kind === "radial" && shape.parts.length > 1))}
      <p class="headline">
        <span class="figure">{headline.value}</span><span class="what">{headline.label}</span>
      </p>
    {/if}
    {#if usable}
      <div class="body" class:beside={round && legend.length}>
        {#if spec.kind === "radar"}
          <div class="plot" style:block-size={`${plotHeight}px`}>
            <Radar {spec} {shape} {detail} {summary} {settled} {onevidence} {glyph} />
          </div>
        {:else if round}
          <Round
            {spec}
            {shape}
            size={plotHeight}
            {detail}
            {summary}
            {settled}
            {middle}
            {onevidence}
            {glyph}
          />
        {:else if spec.kind === "heat"}
          <Heat
            {spec}
            {shape}
            height={plotHeight}
            {compact}
            {quiet}
            {summary}
            {settled}
            {onevidence}
            {glyph}
          />
        {:else}
          <Cartesian
            {spec}
            {shape}
            {labels}
            {detail}
            {summary}
            {uid}
            height={plotHeight}
            {settled}
            {onevidence}
            {glyph}
          />
        {/if}
        {#if legend.length}<ChartLegend
            entries={legend}
            layout={round ? "list" : spec.compact ? "rows" : "row"}
          />{/if}
      </div>
    {:else}<p role="status" class="caption">{m.chart_unavailable()}</p>{/if}
    {#if spec.basis?.trim() && !quiet}<p class="caption basis">{spec.basis}</p>{/if}
    {#if table}
      <details>
        <summary>{exact ? m.chart_exact_values() : m.chart_values()}</summary>
        {#if exact}<p class="caption">{m.chart_precision()}</p>{/if}
        {#if !compact}
          <button type="button" class="copy" onclick={copy}
            >{copied ? m.chart_copied() : m.chart_copy_values()}</button
          >
        {/if}
        <div class="values">
          <table>
            <caption>{title}</caption>
            <thead>
              <tr>
                <th scope="col">{spec.x?.label ?? ""}</th>
                {#each spec.series as series, order (order)}
                  <th scope="col">{series.name || spec.y?.label || ""}</th>
                {/each}
                {#if cited}<th scope="col">{m.chart_sources()}</th>{/if}
              </tr>
            </thead>
            <tbody>
              {#each shape.rows as row (row.key)}
                <tr>
                  <th scope="row">{row.label}</th>
                  {#each row.points as point, order (order)}<td>{pointText(point, spec.y)}</td
                    >{/each}
                  {#if cited}
                    <td class="cites">
                      {#each row.points.flatMap((point) => point?.evidence ?? []) as reference, index (index)}
                        <button
                          type="button"
                          class="chip"
                          disabled={!onevidence}
                          onclick={() => onevidence?.(reference)}
                          >{reference.origin || reference.label}</button
                        >
                      {/each}
                    </td>
                  {/if}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </details>
    {/if}
  </figure>
{/if}

<style>
  .chart {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin: 0;
    min-inline-size: 0;
    color: var(--color-text);
  }

  .chart.tile {
    gap: 0;
    block-size: 100%;
  }

  .headline {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
  }

  .figure {
    font-size: var(--text-title);
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 28px;
  }

  .what {
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 16px;
  }

  .overview .figure {
    font-size: var(--text-overview-figure);
    line-height: 1.1;
  }

  .overview .what {
    font-size: var(--text-overview-label);
    line-height: 1.25;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-inline-size: 0;
  }

  .round .body,
  .radar .body {
    align-items: center;
  }

  .body.beside {
    flex-direction: row;
    gap: 28px;
  }

  .plot {
    position: relative;
    flex: none;
    inline-size: 100%;
    min-inline-size: 0;
  }

  .spark-box {
    display: block;
    inline-size: 100%;
    block-size: 100%;
    min-block-size: 16px;
  }

  .caption,
  summary {
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  .basis {
    color: var(--color-faint);
  }

  details > .caption {
    margin-block: 6px 2px;
  }

  .copy {
    margin-block: 6px 2px;
    padding: 1px 8px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-caption);
    cursor: default;
  }

  .copy:hover {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }

  .values {
    max-block-size: 280px;
    overflow: auto;
  }

  table {
    inline-size: 100%;
    border-collapse: collapse;
  }

  caption,
  th,
  td {
    padding: 6px 8px;
    text-align: start;
    overflow-wrap: anywhere;
  }

  th,
  td {
    border-block-end: 1px solid var(--color-border);
  }

  td {
    font-variant-numeric: tabular-nums;
  }

  .cites {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    max-inline-size: 240px;
    padding: 1px 8px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-caption);
    cursor: default;
    overflow-wrap: anywhere;
  }

  summary:focus-visible,
  .copy:focus-visible,
  .chip:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .chip:hover:not(:disabled) {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }
</style>
