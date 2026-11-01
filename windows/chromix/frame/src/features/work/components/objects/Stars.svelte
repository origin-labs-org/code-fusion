<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import Star from "./Star.svelte";
  import type { Rating } from "../../lib/board/rating";
  /** A rating as five stars filled to its value, its figure and its count beside them. */
  let { rating, size = 12 }: { rating: Rating; size?: number } = $props();
  const share = $derived(Math.min(1, Math.max(0, rating.value / rating.max)));
  const value = $derived(
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(rating.value),
  );
  const count = $derived(rating.count ? new Intl.NumberFormat(undefined).format(rating.count) : "");
  const said = $derived(
    count
      ? m.work_pick_rated_count({ value, max: rating.max, count })
      : m.work_pick_rated({ value, max: rating.max }),
  );
</script>

<span class="rating" role="img" aria-label={said}>
  <span class="row" aria-hidden="true">
    <span class="track"
      >{#each [0, 1, 2, 3, 4] as index (index)}<Star {size} />{/each}</span
    >
    <span class="fill" style:inline-size="{share * 100}%"
      ><span class="track"
        >{#each [0, 1, 2, 3, 4] as index (index)}<Star {size} />{/each}</span
      ></span
    >
  </span>
  <span class="value" aria-hidden="true">{value}</span>
  {#if count}<span class="count" aria-hidden="true">({count})</span>{/if}
</span>

<style>
  .rating {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
  }

  .row {
    position: relative;
    display: inline-flex;
    color: var(--color-border-strong);
  }

  .track {
    display: inline-flex;
    gap: 1px;
  }

  .fill {
    position: absolute;
    inset-block-start: 0;
    inset-inline-start: 0;
    overflow: hidden;
    color: var(--color-warning);
  }

  .fill .track {
    inline-size: max-content;
  }

  .value {
    color: var(--color-text);
    font-weight: 550;
  }

  .count {
    margin-inline-start: -2px;
    color: var(--color-muted);
  }
</style>
