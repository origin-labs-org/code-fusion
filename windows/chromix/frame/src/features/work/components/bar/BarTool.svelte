<script lang="ts">
  import { Popover } from "bits-ui";
  import type { Snippet } from "svelte";
  import type { IconSvgElement } from "@hugeicons/svelte";
  import Icon from "$shared/ui/Icon";
  import KeyHint from "$shared/ui/KeyHint";
  import "$shared/ui/Shine/shine.css";

  let {
    icon,
    label,
    open = false,
    disabled = false,
    small = false,
    wide = false,
    keys = [],
    pressed,
    also,
    content,
    onopenchange,
    onclick,
  }: {
    icon: IconSvgElement;
    label: string;
    open?: boolean;
    disabled?: boolean;
    /** The field's own controls: a size down from the bar's tools. */
    small?: boolean;
    wide?: boolean;
    /** Its shortcut, shown with its name while the pointer rests on it. */
    keys?: string[];
    /** A mode it switches on: shown pressed. */
    pressed?: boolean;
    /** What a click turns it into, named in its hint after its own name. */
    also?: { label: string; keys: string[] };
    /** What the tool opens; without one the tool acts on a click. */
    content?: Snippet;
    onopenchange?: (open: boolean) => void;
    onclick?: () => void;
  } = $props();
  let button = $state<HTMLElement | null>(null);
  /** The panel stands above the sheet the tool is on, whatever height the field has grown to. */
  const sheet = $derived(button?.closest<HTMLElement>(".surface") ?? undefined);
  /** The icon turns in only when it changes, never as the bar first draws. */
  let turned = $state(false);
  let seen: IconSvgElement | undefined;
  $effect(() => {
    if (seen && seen !== icon) turned = true;
    seen = icon;
  });
</script>

{#snippet face(props: Record<string, unknown>)}
  <button
    {...props}
    bind:this={button}
    type="button"
    class="bar-tool"
    class:small
    class:ui-shine={small}
    class:ui-shine-press={small}
    aria-label={label}
    aria-pressed={pressed}
    aria-keyshortcuts={keys.length ? keys.join("+") : undefined}
    {disabled}
    onclick={content ? (props.onclick as (event: MouseEvent) => void) : onclick}
  >
    {#key icon}<span class="glyph" class:turned
        ><Icon {icon} size={small ? 16 : 17} strokeWidth={1.6} /></span
      >{/key}
    <span class="hint" aria-hidden="true"
      >{label}{#if keys.length}<KeyHint {keys} />{/if}{#if also}<span class="also"
          >{also.label}<KeyHint keys={also.keys} /></span
        >{/if}</span
    >
  </button>
{/snippet}

{#if content}
  <Popover.Root {open} onOpenChange={(next) => onopenchange?.(next)}>
    <Popover.Trigger {disabled}>
      {#snippet child({ props })}{@render face(props)}{/snippet}
    </Popover.Trigger>
    <Popover.Content
      class={["work-popover", "ui-shine-sheet", wide && "work-popover-wide"]
        .filter(Boolean)
        .join(" ")}
      side="top"
      align="start"
      customAnchor={sheet}
      sideOffset={sheet ? 10 : 12}
      collisionPadding={12}
      preventScroll={false}
      aria-label={label}
    >
      {@render content()}
    </Popover.Content>
  </Popover.Root>
{:else}{@render face({})}{/if}

<style>
  .bar-tool {
    position: relative;
    display: grid;
    place-items: center;
    flex: none;
    inline-size: 34px;
    block-size: 34px;
    padding: 0;
    border: 0;
    color: var(--color-label-secondary);
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out),
      scale var(--motion-base) var(--ease-spring);
  }

  .bar-tool:not(.small) {
    border-radius: var(--radius-control-compact);
    background: transparent;
  }

  .glyph {
    display: grid;
    place-items: center;
  }

  .glyph.turned {
    animation: glyph-in var(--motion-base) var(--ease-spring);
  }

  .also {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding-inline-start: 10px;
    border-inline-start: 1px solid var(--color-border);
    color: var(--color-muted);
  }

  @keyframes glyph-in {
    from {
      opacity: 0;
      transform: scale(0.7) rotate(-12deg);
    }
  }

  .bar-tool[aria-pressed="true"] {
    background: var(--color-fill-active);
    color: var(--color-text);
  }

  .bar-tool:disabled {
    color: var(--color-faint);
  }

  /* What the tool is and its key, after the pointer has rested a moment; gone
     at once when it leaves or the tool opens its panel. */
  .hint {
    position: absolute;
    inset-block-end: calc(100% + 10px);
    inset-inline-start: 50%;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 6px 5px 10px;
    border-radius: var(--radius-control-compact);
    background: var(--color-float);
    box-shadow: var(--shadow-menu), var(--shine-top);
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 500;
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    translate: -50% 3px;
    transition:
      opacity var(--motion-fast) var(--ease-exit),
      translate var(--motion-fast) var(--ease-exit);
  }

  .bar-tool:focus-visible:not([data-state="open"]) .hint,
  .bar-tool:hover:not(:disabled, [data-state="open"]) .hint {
    opacity: 1;
    translate: -50% 0;
    transition:
      opacity var(--motion-base) var(--ease-out) 450ms,
      translate var(--motion-base) var(--ease-out) 450ms;
  }

  .bar-tool:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: -2px;
  }

  /* The field's own +: the shine plate, round, the send button's twin across the field. */
  .bar-tool.small {
    --shine-radius: var(--radius-capsule);

    inline-size: 32px;
    block-size: 32px;
    color: var(--color-label-secondary);
  }

  .bar-tool:not(.small):hover:not(:disabled),
  .bar-tool:not(.small)[data-state="open"] {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }

  .bar-tool.small:hover:not(:disabled),
  .bar-tool.small[data-state="open"] {
    color: var(--color-text);
  }

  .bar-tool:not(.small):active:not(:disabled) {
    scale: 0.94;
    transition-duration: var(--motion-instant);
  }

  :global(.work-popover) {
    z-index: 40;
    box-sizing: border-box;
    inline-size: min(380px, calc(100vw - 24px));
    max-block-size: calc(100vh - 120px);
    overflow: auto;
    padding: 8px;
    border-radius: var(--radius-menu);
    background: var(--color-float);
    box-shadow: var(--shadow-menu);
    color: var(--color-text);
    font-size: var(--text-body);
    outline: none;
    transform-origin: var(--bits-floating-transform-origin, bottom);
    animation: work-popover-in var(--motion-slow) var(--ease-smooth);
  }

  :global(.work-popover-wide) {
    inline-size: min(460px, calc(100vw - 24px));
  }

  :global(.work-popover[data-state="closed"]) {
    animation: work-popover-out var(--motion-fast) var(--ease-exit) forwards;
  }

  @keyframes work-popover-in {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(4px);
    }
  }

  @keyframes work-popover-out {
    to {
      opacity: 0;
      transform: scale(0.99);
    }
  }

  @media (forced-colors: active) {
    :global(.work-popover) {
      border: 1px solid ButtonText;
      backdrop-filter: none;
    }
  }
</style>
