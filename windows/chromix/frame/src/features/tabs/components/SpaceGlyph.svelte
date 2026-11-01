<script lang="ts">
  import "./space-hue.css";
  import type { SpaceIconView } from "$shared/ipc/bindings";
  import Icon from "$shared/ui/Icon";
  import { SPACE_COLORS, SPACE_SYMBOLS } from "../lib/space-look";

  let {
    icon,
    color,
    size = 16,
  }: {
    icon: SpaceIconView | null;
    color: number;
    size?: number;
  } = $props();
  const hue = $derived(Number.isInteger(color) && color >= 0 && color < SPACE_COLORS ? color : 0);
  const symbol = $derived(
    icon?.kind === "symbol" ? (SPACE_SYMBOLS[icon.index] ?? SPACE_SYMBOLS[0]) : null,
  );
</script>

<!-- The mark a person gave the space, in the hue they chose: a glyph drawn in
     it, or an emoji as it is. A space without one shows nothing. -->
{#if icon !== null}<span
    class="space-glyph"
    data-space-hue={hue}
    data-kind={icon.kind}
    style:--glyph-size={`${size}px`}
    aria-hidden="true"
    >{#if icon.kind === "emoji"}<span class="emoji">{icon.text}</span>{:else if symbol}<Icon
        icon={symbol}
        {size}
        strokeWidth={size >= 24 ? 1.6 : 1.8}
      />{/if}</span
  >{/if}

<style>
  .space-glyph {
    display: grid;
    flex: none;
    inline-size: var(--glyph-size);
    block-size: var(--glyph-size);
    color: var(--space-ink);
    place-items: center;
  }

  .emoji {
    font-size: calc(var(--glyph-size) * 0.94);
    line-height: 1;
  }
</style>
