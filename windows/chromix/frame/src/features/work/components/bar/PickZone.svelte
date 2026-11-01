<script lang="ts">
  import type { Snippet } from "svelte";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$shared/ui/Icon";

  let {
    icon,
    text,
    action,
  }: {
    icon: IconSvgElement;
    text: string;
    action?: Snippet;
  } = $props();
</script>

<!-- What the + menu offers when there is nothing to list: a quiet line that says what to do, and the one control for it. -->
<div class="zone">
  <span class="mark" aria-hidden="true"><Icon {icon} size={16} strokeWidth={1.7} /></span>
  <span class="text">{text}</span>
  {#if action}{@render action()}{/if}
</div>

<style>
  .zone {
    display: flex;
    align-items: center;
    gap: 10px;
    min-block-size: 56px;
    box-sizing: border-box;
    padding: 10px 10px 10px 14px;
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-row);
  }

  .mark {
    display: inline-flex;
    flex: none;
    color: var(--color-muted);
  }

  .text {
    flex: 1;
    min-inline-size: 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.35;
    text-wrap: pretty;
  }

  .zone > :global(.ui-button) {
    flex: none;
  }
</style>
