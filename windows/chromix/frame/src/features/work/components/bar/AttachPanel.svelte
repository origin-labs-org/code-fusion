<script lang="ts" module>
  export type AttachKind = "tabs" | "document" | "image" | "link" | "folder";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "$shared/ui/Button";
  import Field from "$shared/ui/Field";
  import Icon from "$shared/ui/Icon";
  import Morph from "./Morph.svelte";
  import PickZone from "./PickZone.svelte";
  import "$shared/ui/Shine/shine.css";
  import { BrowserIcon, File01Icon, FolderAddIcon, Image01Icon, Link04Icon } from "../../lib/icons";
  import * as m from "$shared/i18n/messages";

  let {
    kind = $bindable("tabs"),
    busy = false,
    folderPending = false,
    picker,
    media,
    onaddlink,
    onaddfolder,
    onchoosefolder,
  }: {
    kind?: AttachKind;
    busy?: boolean;
    folderPending?: boolean;
    picker: Snippet;
    media: Snippet<["document" | "image"]>;
    /** Resolves false when the address could not become a card. */
    onaddlink: (raw: string) => Promise<boolean>;
    onaddfolder: (path: string) => Promise<boolean>;
    onchoosefolder: () => void;
  } = $props();

  const segments = [
    { key: "tabs" as const, icon: BrowserIcon, label: m.work_env_tabs },
    { key: "document" as const, icon: File01Icon, label: m.work_env_documents },
    { key: "image" as const, icon: Image01Icon, label: m.work_env_images },
    { key: "link" as const, icon: Link04Icon, label: m.work_env_links },
    { key: "folder" as const, icon: FolderAddIcon, label: m.work_env_folders },
  ];
  let link = $state("");
  let linkPending = $state(false);
  let linkFailed = $state(false);
  let folder = $state("");

  async function addLink() {
    if (!link.trim() || linkPending || busy) return;
    linkPending = true;
    linkFailed = false;
    try {
      if (await onaddlink(link)) link = "";
      else linkFailed = true;
    } finally {
      linkPending = false;
    }
  }

  async function addFolder() {
    if (!folder.trim() || folderPending || busy) return;
    if (await onaddfolder(folder.trim())) folder = "";
  }
</script>

<!-- Everything that can join the canvas from outside it, one kind at a time. The panel is as tall as the kind needs, and the switcher stays at its foot. -->
<div class="attach">
  <Morph view={kind} order={segments.findIndex((segment) => segment.key === kind)}>
    {#if kind === "tabs"}
      {@render picker()}
    {:else if kind === "folder"}
      <div class="folder">
        <PickZone icon={FolderAddIcon} text={m.work_env_folder_hint()}>
          {#snippet action()}<Button
              size="compact"
              disabled={busy || folderPending}
              onclick={onchoosefolder}>{m.work_env_folder_choose()}</Button
            >{/snippet}
        </PickZone>
        <form
          class="create"
          onsubmit={(event) => {
            event.preventDefault();
            void addFolder();
          }}
        >
          <Field
            label={m.work_env_folder_placeholder()}
            labelHidden
            placeholder={m.work_env_folder_placeholder()}
            bind:value={folder}
            maxlength={1024}
            disabled={busy || folderPending}
          /><Button type="submit" size="compact" disabled={busy || folderPending || !folder.trim()}
            >{m.work_env_folder_add()}</Button
          >
        </form>
      </div>
    {:else if kind === "link"}
      <div class="compose">
        <span class="tile ui-shine" aria-hidden="true"><Icon icon={Link04Icon} size={22} /></span>
        <form
          class="create"
          onsubmit={(event) => {
            event.preventDefault();
            void addLink();
          }}
        >
          <Field
            type="url"
            label={m.work_env_link_placeholder()}
            labelHidden
            placeholder={m.work_env_link_placeholder()}
            bind:value={link}
            maxlength={2048}
            disabled={busy || linkPending}
          /><Button type="submit" size="compact" disabled={busy || linkPending || !link.trim()}
            >{m.work_env_link_add()}</Button
          >
        </form>
        {#if linkFailed}<p class="note" role="alert">{m.work_env_link_failed()}</p>{/if}
      </div>
    {:else}
      {@render media(kind)}
    {/if}
  </Morph>
  <div class="segments" role="group" aria-label={m.work_tool_attach()}>
    {#each segments as segment (segment.key)}
      <button
        type="button"
        class="segment"
        class:ui-shine={kind === segment.key}
        title={segment.label()}
        aria-pressed={kind === segment.key}
        onclick={() => (kind = segment.key)}
      >
        <Icon icon={segment.icon} size={15} strokeWidth={1.7} /><span class="name"
          ><span>{segment.label()}</span></span
        >
      </button>
    {/each}
  </div>
</div>

<style>
  .attach {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-inline-size: 0;
  }

  /* The kinds of thing to add: the chosen one opens into its name, the rest stay glyphs. */
  .segments {
    display: flex;
    flex: none;
    gap: 2px;
    padding: 3px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
  }

  .segment {
    --shine-radius: var(--radius-capsule);

    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 1 1 0;
    min-inline-size: 0;
    block-size: 32px;
    padding-inline: 0;
    overflow: hidden;
    white-space: nowrap;
    border: 0;
    border-radius: var(--shine-radius);
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    cursor: default;
    transition:
      flex-grow var(--motion-slow) var(--ease-emphasized),
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  .segment:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  .segment[aria-pressed="true"] {
    flex-grow: 2.6;
    background: var(--row-active);
    color: var(--color-text);
  }

  .segment:not([aria-pressed="true"]):hover {
    background: color-mix(in oklab, var(--row-active) 55%, transparent);
    color: var(--color-text);
  }

  .name {
    display: grid;
    grid-template-columns: 0fr;
    transition: grid-template-columns var(--motion-slow) var(--ease-emphasized);
  }

  .name > span {
    min-inline-size: 0;
    overflow: hidden;
    padding-inline-start: 0;
    opacity: 0;
    transition:
      opacity var(--motion-fast) var(--ease-exit),
      padding-inline-start var(--motion-slow) var(--ease-emphasized);
  }

  .segment[aria-pressed="true"] .name {
    grid-template-columns: 1fr;
  }

  .segment[aria-pressed="true"] .name > span {
    padding-inline-start: 7px;
    opacity: 1;
    transition:
      opacity var(--motion-base) var(--ease-out) 80ms,
      padding-inline-start var(--motion-slow) var(--ease-emphasized);
  }

  .compose {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: stretch;
    justify-content: center;
    gap: 14px;
    padding: 12px 8px 14px;
  }

  .folder {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 2px 0 4px;
  }

  .compose > :global(.ui-button) {
    align-self: center;
  }

  .tile {
    --shine-radius: var(--radius-control-large);

    display: grid;
    align-self: center;
    inline-size: 52px;
    block-size: 52px;
    color: var(--color-label-secondary);
    place-items: center;
  }

  .create {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .create :global(.ui-field) {
    flex: 1;
  }

  .note {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-caption);
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .segment,
    .name,
    .name > span {
      transition: none;
    }
  }
</style>
