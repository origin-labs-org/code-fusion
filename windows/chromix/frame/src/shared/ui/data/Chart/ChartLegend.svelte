<script lang="ts">
  /**
   * A square of each entry's colour and its label: a row under the plot, two
   * rows on a card, or a list beside a round chart with each part's share.
   */
  let {
    entries,
    layout = "row",
  }: {
    entries: readonly { key: string; label: string; color: string; share?: string }[];
    layout?: "row" | "rows" | "list";
  } = $props();
</script>

<ul class="chart-legend {layout}">
  {#each entries as entry (entry.key)}
    <li>
      <span class="swatch" style:background={entry.color}></span><span class="name"
        >{entry.label}</span
      >{#if entry.share}<span class="share">{entry.share}</span>{/if}
    </li>
  {/each}
</ul>

<style>
  .chart-legend {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 6px 16px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  /* A card's legend: at most two rows, filled down then across. */
  .rows {
    display: grid;
    grid-auto-columns: minmax(0, max-content);
    grid-auto-flow: column;
    grid-template-rows: repeat(2, auto);
    justify-content: start;
  }

  /* A round chart names its parts beside it, each with its share or value. */
  .list {
    display: grid;
    flex: 1;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px 8px;
    justify-content: stretch;
    color: var(--color-text);
    font-size: var(--text-label);
  }

  li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-inline-size: 0;
  }

  .list li {
    display: contents;
  }

  .swatch {
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: var(--radius-swatch);
  }

  .list .swatch {
    inline-size: 10px;
    block-size: 10px;
  }

  .name {
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .share {
    color: var(--color-muted);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .list .share {
    color: var(--color-text);
    font-weight: 550;
  }
</style>
