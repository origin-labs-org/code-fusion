<script lang="ts">
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$shared/ui/Icon";
  import Morph from "./Morph.svelte";
  import { Calendar03Icon, CheckListIcon, StickyNote03Icon, Table01Icon } from "../../lib/icons";
  import * as m from "$shared/i18n/messages";
  import type { Snippet } from "svelte";

  export type BlockKind = "note" | "checklist" | "table" | "calendar";
  let {
    busy = false,
    view = $bindable("blocks"),
    notes,
    onpick,
  }: {
    busy?: boolean;
    /** What the panel shows: the kinds of block, or the person's notes to put on the canvas. */
    view?: "blocks" | "notes";
    /** The notes list, when notes are on: Note opens it in place instead of making a blank one. */
    notes?: Snippet<[() => void]>;
    onpick: (kind: BlockKind) => void;
  } = $props();
  const BLOCKS: {
    kind: BlockKind;
    icon: IconSvgElement;
    name: () => string;
    hint: () => string;
  }[] = [
    { kind: "note", icon: StickyNote03Icon, name: m.work_block_note, hint: m.work_block_note_hint },
    {
      kind: "checklist",
      icon: CheckListIcon,
      name: m.work_block_checklist,
      hint: m.work_block_checklist_hint,
    },
    { kind: "table", icon: Table01Icon, name: m.work_block_table, hint: m.work_block_table_hint },
    {
      kind: "calendar",
      icon: Calendar03Icon,
      name: m.work_block_calendar,
      hint: m.work_block_calendar_hint,
    },
  ];
</script>

<!-- Things the person can put on the canvas themselves; the agent fills them when asked. -->
<Morph view={view === "notes" && notes ? "notes" : "blocks"} order={view === "notes" ? 1 : 0}>
  {#if view === "notes" && notes}
    {@render notes(() => (view = "blocks"))}
  {:else}<ul class="blocks" aria-label={m.work_tool_blocks()}>
      {#each BLOCKS as block (block.kind)}<li>
          <button
            type="button"
            class="ui-menu-item block"
            disabled={busy}
            onclick={() => (block.kind === "note" && notes ? (view = "notes") : onpick(block.kind))}
          >
            <span class="tile" aria-hidden="true"><Icon icon={block.icon} size={16} /></span>
            <span class="text">
              <span class="name">{block.name()}</span>
              <span class="hint">{block.hint()}</span>
            </span>
          </button>
        </li>{/each}
    </ul>{/if}
</Morph>

<style>
  .blocks {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  button.ui-menu-item {
    inline-size: 100%;
    min-block-size: 48px;
    border: 0;
    background: transparent;
    font: inherit;
    text-align: start;
  }

  button.ui-menu-item:disabled {
    opacity: 0.45;
  }

  button.ui-menu-item:focus-visible,
  button.ui-menu-item:hover:not(:disabled) {
    background: var(--row-active);
  }

  .block {
    gap: 10px;
  }

  .tile {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 30px;
    block-size: 30px;
    border-radius: var(--radius-inset);
    background: var(--color-fill);
    color: var(--color-label-secondary);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-inline-size: 0;
  }

  .name {
    color: var(--color-text);
    font-size: var(--text-body);
    font-weight: 550;
  }

  .hint {
    color: var(--color-muted);
    font-size: var(--text-label);
  }
</style>
