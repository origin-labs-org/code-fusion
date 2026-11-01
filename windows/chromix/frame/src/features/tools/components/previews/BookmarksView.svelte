<script lang="ts">
  import "$shared/ui/Menu/surface.css";
  import {
    Add01Icon,
    BookmarkAdd02Icon,
    FolderAddIcon,
    Link01Icon,
  } from "@hugeicons/core-free-icons";
  import type { ToolHostProps } from "$session/tool-drafts.svelte";
  import { commands } from "$shared/ipc/bindings";
  import { keymap } from "$domain/keymap";
  import { IS_MAC } from "$shared/platform";
  import { acceleratorKeys } from "$shared/lib/accelerator";
  import Disclosure from "$shared/ui/Disclosure";
  import LazyView from "$shared/ui/LazyView";
  import Icon from "$shared/ui/Icon";
  import { bookmarkCompose, loadBookmarksPanel } from "$features/bookmarks";
  import ToolFrame from "../ToolFrame.svelte";
  import * as m from "$shared/i18n/messages";
  let props: ToolHostProps = $props();

  const keys = $derived.by(() => {
    const accelerator = keymap.all().find((entry) => entry.id === "bookmark.add")?.accelerator;
    return accelerator ? acceleratorKeys(accelerator, IS_MAC).join(IS_MAC ? "" : "+") : null;
  });
</script>

<ToolFrame {...props} caption={false} searchLabel={m.bookmarks_search()} scrolls={false}>
  {#snippet actions()}<Disclosure
      menu
      align="end"
      label={m.bookmarks_menu()}
      triggerClass="tool-overflow"
      panelClass="bookmarks-add"
    >
      {#snippet trigger()}<Icon icon={Add01Icon} size={16} />{/snippet}
      <button
        type="button"
        role="menuitem"
        class="ui-menu-item add-item"
        onclick={() => void commands.runCommand("bookmark.add").catch(() => {})}
      >
        <span class="ui-menu-icon"><Icon icon={BookmarkAdd02Icon} size={16} /></span>
        <span>{m.bookmarks_add_page()}</span>
        {#if keys}<span class="add-keys">{keys}</span>{/if}
      </button>
      <button
        type="button"
        role="menuitem"
        class="ui-menu-item add-item"
        onclick={() => bookmarkCompose.request("link")}
      >
        <span class="ui-menu-icon"><Icon icon={Link01Icon} size={16} /></span>
        <span>{m.bookmarks_add_link()}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        class="ui-menu-item add-item"
        onclick={() => bookmarkCompose.request("folder")}
      >
        <span class="ui-menu-icon"><Icon icon={FolderAddIcon} size={16} /></span>
        <span>{m.bookmarks_menu_new_folder()}</span>
      </button>
    </Disclosure>{/snippet}
  <LazyView
    loader={loadBookmarksPanel}
    loadingLabel={m.panel_loading()}
    failureLabel={m.panel_load_failed()}
    retryLabel={m.panel_retry()}
    >{#snippet children(Panel)}<Panel
        profile={props.profile}
        query={props.state.query}
      />{/snippet}</LazyView
  >
</ToolFrame>

<style>
  /* It opens over a list of text, so it is solid rather than glass. */
  :global(.bookmarks-add) {
    min-width: 232px;
    background: var(--color-float);
    backdrop-filter: none;
  }

  .add-item {
    width: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: var(--text-body);
    text-align: start;
  }

  .add-item:is(:hover, :focus-visible) {
    outline: none;
    background: var(--row-active);
  }

  .add-item:active {
    background: var(--row-pressed);
  }

  .add-keys {
    margin-inline-start: auto;
    color: var(--color-faint);
    font-size: var(--text-label);
    letter-spacing: 0.02em;
  }
</style>
