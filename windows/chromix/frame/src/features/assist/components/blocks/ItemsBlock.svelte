<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import type { PageAssistItemV1 } from "$shared/ipc/bindings";
  import "$shared/ui/Shine/shine.css";

  let {
    items,
    onfocus,
    onopen,
  }: {
    items: readonly PageAssistItemV1[];
    /** Emphasises the item's mark on its page; null lets it go. A press also brings the page forward. */
    onfocus: (n: number | null, pressed?: boolean) => void;
    /** ⌘/Ctrl-click: the item's own page in a new tab. */
    onopen: (url: string) => void;
  } = $props();

  function click(event: MouseEvent, item: PageAssistItemV1) {
    if ((event.metaKey || event.ctrlKey) && item.url) {
      onopen(item.url);
      return;
    }
    if (item.marked) onfocus(item.n, true);
  }
</script>

<ol class="items" aria-label={m.assist_items_label({ count: items.length })}>
  {#each items as item (item.n)}
    <li>
      <button
        type="button"
        class="item ui-shine ui-shine-press"
        data-marked={item.marked || undefined}
        title={item.url ?? undefined}
        onpointerenter={() => item.marked && onfocus(item.n)}
        onpointerleave={() => item.marked && onfocus(null)}
        onfocus={() => item.marked && onfocus(item.n)}
        onblur={() => item.marked && onfocus(null)}
        onclick={(event) => click(event, item)}
      >
        <span class="badge" aria-hidden="true">{item.n}</span>
        <span class="words">
          <span class="title">{item.title}</span>
          {#if item.meta.length}<span class="meta">{item.meta.join(" · ")}</span>{/if}
        </span>
      </button>
    </li>
  {/each}
</ol>

<style>
  .items {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .item {
    --shine-radius: var(--radius-card);

    display: flex;
    align-items: flex-start;
    gap: 11px;
    box-sizing: border-box;
    inline-size: 100%;
    padding: 12px;
    border: 0;
    color: var(--color-text);
    font: inherit;
    text-align: start;
  }

  .badge {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 20px;
    block-size: 20px;
    margin-block-start: 0.5px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.25px var(--color-border-strong);
    color: var(--color-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    font-weight: 650;
    line-height: 1;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  /* On the page now: the same solid numeral the page shows beside the item. */
  [data-marked] .badge {
    background: var(--color-lit);
    box-shadow: none;
    color: var(--color-on-lit);
  }

  .words {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-inline-size: 0;
  }

  .title {
    display: -webkit-box;
    overflow: hidden;
    font-size: var(--text-page-title);
    font-weight: 600;
    letter-spacing: -0.008em;
    line-height: 1.35;
    overflow-wrap: anywhere;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .meta {
    overflow: hidden;
    color: var(--color-muted);
    font-size: 12.5px;
    font-variant-numeric: tabular-nums;
    line-height: 17px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (forced-colors: active) {
    .badge {
      border: 1px solid ButtonText;
    }
  }
</style>
