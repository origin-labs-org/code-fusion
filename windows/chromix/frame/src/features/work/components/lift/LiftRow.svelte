<script lang="ts">
  import type { Snippet } from "svelte";
  /**
   * A row in a lift's list: a mark, what it is, where or why, and an optional
   * figure at its end. It is a button only when it leads somewhere.
   */
  let {
    title,
    detail = "",
    trailing = "",
    tone = "plain",
    mono = false,
    wrap = false,
    leading,
    onclick,
  }: {
    title: string;
    detail?: string;
    /** A figure at the row's end: a time, a count. */
    trailing?: string;
    /** `quiet` for words said rather than done; `live` for the step going on now; `failed` for one that did not finish. */
    tone?: "plain" | "quiet" | "live" | "failed";
    /** A command as it was typed. */
    mono?: boolean;
    /** Words that read whole rather than on one line. */
    wrap?: boolean;
    leading?: Snippet;
    onclick?: () => void;
  } = $props();
</script>

{#snippet body()}
  {#if leading}<span class="mark" aria-hidden="true">{@render leading()}</span>{/if}
  <span class="words">
    <span class="title" class:mono class:wrap>{title}</span>
    {#if detail}<span class="detail" class:wrap>{detail}</span>{/if}
  </span>
  {#if trailing}<span class="trailing">{trailing}</span>{/if}
{/snippet}

<li class="lift-row {tone}" class:open={!!onclick}>
  {#if onclick}<button type="button" {onclick}>{@render body()}</button>{:else}<div>
      {@render body()}
    </div>{/if}
</li>

<style>
  .lift-row {
    min-inline-size: 0;
    margin-inline: -8px;
  }

  button,
  div {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    box-sizing: border-box;
    inline-size: 100%;
    min-inline-size: 0;
    min-block-size: 32px;
    padding: 6px 8px;
    border: 0;
    border-radius: var(--radius-row);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: start;
  }

  button {
    cursor: default;
    transition: background-color var(--motion-instant) var(--ease-out);
  }

  button:hover {
    background: var(--row-hover);
  }

  button:active {
    background: var(--row-pressed);
  }

  button:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 20px;
    block-size: 20px;
    color: var(--color-faint);
  }

  .live .mark {
    color: var(--color-lit);
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-inline-size: 0;
  }

  .title,
  .detail {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title {
    font-size: var(--text-body);
    line-height: 20px;
  }

  .detail {
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 16px;
  }

  .wrap {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--text-label);
  }

  .quiet .title {
    color: var(--color-label-secondary);
  }

  .live .title {
    font-weight: 550;
  }

  .failed .title {
    color: var(--color-muted);
  }

  .failed .detail {
    color: var(--color-danger);
  }

  .trailing {
    flex: none;
    padding-inline-start: 12px;
    color: var(--color-faint);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
    line-height: 20px;
  }
</style>
