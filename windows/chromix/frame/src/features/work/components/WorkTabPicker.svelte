<script lang="ts">
  import type { TabView } from "$shared/ipc/bindings";
  import FavIcon from "$shared/ui/FavIcon";
  import { favicons } from "$domain/favicons";
  import Button from "$shared/ui/Button";
  import { BrowserIcon } from "../lib/icons";
  import * as m from "$shared/i18n/messages";
  import "./bar/pick.css";

  let {
    tabs,
    spaceName,
    currentTabId = null,
    attachedTabIds = [],
    pending = false,
    status = "",
    openTabs = false,
    onopentabs,
    onattach,
    onopen,
    onnewtab,
  }: {
    /** The current Space's authoritative tab projection, never a URL-derived list. */
    tabs: readonly TabView[];
    spaceName: string;
    /** The tab the Space is on; it reads first, the way a tab strip does. */
    currentTabId?: string | null;
    attachedTabIds?: readonly TabView["id"][];
    pending?: boolean;
    status?: string;
    /** The person's consent to list every open tab, for the next request only. */
    openTabs?: boolean;
    onopentabs?: (on: boolean) => void;
    onattach: (ids: TabView["id"][]) => void;
    onopen: (id: TabView["id"]) => void;
    onnewtab: () => void;
  } = $props();
  const id = $props.id();
  let query = $state("");
  let selected = $state<string[]>([]);
  const visible = $derived(
    tabs
      .filter((tab) =>
        `${tab.title} ${tab.url ?? ""}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      )
      .slice()
      .sort((a, b) => Number(b.id === currentTabId) - Number(a.id === currentTabId)),
  );
  const eligible = $derived(
    selected.filter((id) => tabs.some((tab) => tab.id === id) && !attachedTabIds.includes(id)),
  );
  function toggle(tabId: string) {
    selected = selected.includes(tabId)
      ? selected.filter((id) => id !== tabId)
      : [...selected, tabId];
  }
  function host(url: string | null) {
    if (!url) return "";
    try {
      return new URL(url).host;
    } catch {
      return "";
    }
  }
</script>

<section class="picker" aria-label={m.work_env_tabs()} aria-busy={pending}>
  <header><strong>{m.work_env_tabs()}</strong><span>{spaceName}</span></header>
  {#if onopentabs}<label class="all" class:chosen={openTabs}>
      <input
        type="checkbox"
        class="pick-check"
        checked={openTabs}
        disabled={pending}
        onchange={(event) => onopentabs?.(event.currentTarget.checked)}
      />
      <span class="identity">
        <strong>{m.work_env_all_tabs()}</strong>
        <span class="where">{m.work_env_all_tabs_note()}</span>
      </span>
    </label>{/if}
  <label class="search" for={id}>{m.work_env_search_tabs()}</label>
  <input {id} type="search" bind:value={query} placeholder={m.work_env_search_tabs()} />
  <ul>
    {#each visible as tab (tab.id)}
      {@const attached = attachedTabIds.includes(tab.id)}
      <li
        class:chosen={eligible.includes(tab.id)}
        class:current={tab.id === currentTabId}
        class:attached
      >
        <label class="tab">
          <input
            type="checkbox"
            class="pick-check"
            checked={eligible.includes(tab.id)}
            disabled={pending || attached}
            onchange={() => toggle(tab.id)}
          />
          <FavIcon
            image={favicons.image(tab.icon)}
            tone={favicons.tone(tab.icon)}
            fallback={BrowserIcon}
          />
          <span class="identity">
            <strong>{tab.title || m.work_env_untitled_tab()}</strong>
            <span class="where"
              >{#if tab.id === currentTabId}<span class="badge">{m.work_env_current_tab()}</span
                >{/if}{host(tab.url)}</span
            >
          </span>
        </label>
        {#if attached}<span class="attached-mark">{m.work_env_attached()}</span>{/if}
        <Button
          size="compact"
          disabled={pending}
          aria-label={m.work_env_open_tab({ title: tab.title || m.work_env_untitled_tab() })}
          onclick={() => onopen(tab.id)}>{m.work_env_open_here()}</Button
        >
      </li>
    {:else}<li class="empty">{query ? m.work_env_no_matches() : m.work_env_no_tabs()}</li>{/each}
  </ul>
  {#if status}<p role="status">{status}</p>{/if}
  <footer>
    <Button size="compact" variant="ghost" disabled={pending} onclick={onnewtab}
      >{m.work_env_new_tab()}</Button
    ><Button
      size="compact"
      variant="primary"
      disabled={pending || eligible.length === 0}
      onclick={() => onattach([...eligible])}
      >{pending ? m.work_env_pending() : m.work_env_add_tabs({ count: eligible.length })}</Button
    >
  </footer>
</section>

<style>
  .picker {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 8px;
    min-block-size: 0;
    min-inline-size: 0;
  }

  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  /* The segment above already says Tabs; the header says whose they are. */
  header strong {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  header span,
  .where,
  .attached-mark,
  .empty {
    color: var(--color-muted);
    font-size: var(--text-caption);
  }

  header {
    padding-inline: 4px;
  }

  .search {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }

  input[type="search"] {
    inline-size: 100%;
    box-sizing: border-box;
    block-size: var(--field-height);
    padding: 0 var(--control-inset);
    border: 0;
    border-radius: var(--radius-field);
    background: var(--color-field);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-label);
    outline: none;
    transition:
      background-color var(--motion-instant) var(--ease-smooth),
      box-shadow var(--motion-instant) var(--ease-smooth);
  }

  input[type="search"]:hover {
    background: var(--color-field-hover);
  }

  input[type="search"]:focus {
    background: var(--color-field-hover);
    box-shadow: var(--shadow-field-focus);
  }

  input[type="search"]::placeholder {
    color: var(--color-faint);
  }

  ul {
    list-style: none;
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-block-size: 0;
    max-block-size: 244px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
  }

  /* A row is a tab: its mark, its title, and where it is. */
  li,
  .all {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 6px 2px 10px;
    border-radius: var(--radius-control);
    transition: background-color var(--motion-fast) var(--ease-smooth);
  }

  /* Every tab at once, as titles and addresses: a row of its own above the list. */
  .all {
    min-block-size: 40px;
    background: var(--color-fill);
    cursor: default;
  }

  li:hover,
  .all:hover {
    background: var(--row-active);
  }

  .all.chosen,
  li.chosen {
    background: var(--row-active);
    box-shadow: var(--row-rim);
  }

  li.attached {
    opacity: 0.55;
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-block-size: 40px;
    min-inline-size: 0;
    cursor: default;
  }

  /* Opening a tab is the exception: it shows when the row is looked at. */
  li :global(.ui-button) {
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-out);
  }

  li:hover :global(.ui-button),
  li:focus-within :global(.ui-button) {
    opacity: 1;
  }

  .identity {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-inline-size: 0;
  }

  .identity strong {
    font-size: var(--text-body);
    font-weight: 500;
  }

  .identity strong,
  .where {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  li.current .identity strong {
    font-weight: 600;
  }

  .badge {
    margin-inline-end: 6px;
    padding: 0 6px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill-active);
    color: var(--color-label-secondary);
  }

  .attached-mark {
    flex: none;
  }

  p {
    margin: 0;
    padding-inline: 4px;
  }

  .empty {
    padding: 12px 10px;
  }

  footer {
    flex: none;
    flex-wrap: wrap;
    padding-block-start: 2px;
  }

  .all .where {
    white-space: normal;
  }

  @media (prefers-reduced-motion: reduce) {
    li,
    .all,
    li :global(.ui-button) {
      transition: none;
    }
  }
</style>
