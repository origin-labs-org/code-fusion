<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { tabs } from "$domain/tabs";
  import { favicons } from "$domain/favicons";
  import FavIcon from "$shared/ui/FavIcon";
  import Icon from "$shared/ui/Icon";
  import { Orb } from "$shared/ui/presence";
  import type { PageAssistOpenedV1 } from "$shared/ipc/bindings";
  import { isOne } from "../../lib/format";
  import { Globe02Icon, Tick02Icon } from "../../lib/icons";
  import "../assist.css";

  let { rows }: { rows: readonly PageAssistOpenedV1[] } = $props();

  const opened = $derived(rows.filter((row) => row.state === "opened").length);
  const settled = $derived(rows.every((row) => row.state === "opened" || row.state === "failed"));
  const live = $derived(new Map(tabs.tabs().map((tab) => [tab.id, tab])));

  function markOf(row: PageAssistOpenedV1) {
    const tab = row.tab ? live.get(row.tab) : undefined;
    return tab ? favicons.mark(tab.icon, tab.url) : favicons.forPage(row.url);
  }
</script>

<section class="opened" aria-label={m.assist_opened_label()}>
  <p class="caption" role="status">
    {settled
      ? (isOne(opened) ? m.assist_opened_done_one : m.assist_opened_done)({ count: opened })
      : (isOne(rows.length) ? m.assist_opened_working_one : m.assist_opened_working)({
          count: rows.length,
        })}
  </p>
  <ul class="rows assist-list">
    {#each rows as row (row.index)}
      {@const mark = markOf(row)}
      {@const shown = !!row.tab && live.has(row.tab)}
      <li>
        <button
          type="button"
          class="row"
          data-state={row.state}
          disabled={!shown}
          title={row.url}
          onclick={() => row.tab && tabs.activate(row.tab)}
        >
          <span class="mark"
            ><FavIcon
              image={mark?.image ?? null}
              tone={mark?.tone}
              size={16}
              fallback={Globe02Icon}
            /></span
          >
          <span class="host">{row.host}</span>
          <span class="state" aria-hidden={row.state !== "failed" || undefined}>
            {#if row.state === "opening"}<Orb size={13} />
            {:else if row.state === "opened"}<Icon icon={Tick02Icon} size={14} strokeWidth={2} />
            {:else if row.state === "failed"}{m.assist_opened_failed()}
            {:else}<span class="queued"></span>{/if}
          </span>
        </button>
      </li>
    {/each}
  </ul>
</section>

<style>
  .opened {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .caption {
    margin: 0;
    padding-inline: 2px;
    color: var(--color-muted);
    font-size: 12.5px;
    line-height: 17px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    inline-size: 100%;
    min-block-size: 36px;
    padding: 0 10px;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: default;
    transition: background-color var(--motion-instant) var(--ease-smooth);
  }

  .row:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .row:disabled {
    color: var(--color-text);
  }

  .row:hover:not(:disabled) {
    background: var(--row-hover);
  }

  .row[data-state="failed"],
  .row[data-state="queued"] {
    color: var(--color-muted);
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 16px;
    block-size: 16px;
  }

  .row[data-state="failed"] .mark {
    opacity: 0.5;
  }

  .host {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    font-size: 13.5px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .state {
    display: grid;
    flex: none;
    place-items: center;
    min-inline-size: 16px;
    color: var(--color-muted);
    font-size: 12px;
  }

  .row[data-state="opened"] .state {
    color: var(--color-text);
    animation: landed 260ms var(--ease-spring) both;
  }

  @keyframes landed {
    from {
      opacity: 0;
      scale: 0.6;
    }
  }

  .queued {
    inline-size: 5px;
    block-size: 5px;
    border-radius: 50%;
    background: var(--color-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .row[data-state="opened"] .state {
      animation: none;
    }
  }
</style>
