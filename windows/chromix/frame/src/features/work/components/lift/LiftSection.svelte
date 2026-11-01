<script lang="ts">
  import type { Snippet } from "svelte";
  /** One group of a lift's body: a quiet heading, its count, and its rows. */
  let {
    title,
    count,
    list = true,
    children,
  }: {
    title: string;
    /** How many there are, when the rows may be cut short or folded. */
    count?: number;
    /** The body is rows of a list; otherwise it is laid out by the caller. */
    list?: boolean;
    children: Snippet;
  } = $props();
  const id = $props.id();
</script>

<section class="lift-section" aria-labelledby={id}>
  <h3 {id}>
    {title}{#if count !== undefined}<span class="count">{count}</span>{/if}
  </h3>
  {#if list}<ul>{@render children()}</ul>{:else}{@render children()}{/if}
</section>

<style>
  .lift-section {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-inline-size: 0;
  }

  h3 {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin: 0 0 4px;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 600;
    line-height: 16px;
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .count {
    color: var(--color-faint);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
  }
</style>
