<script lang="ts">
  import { Globe02Icon } from "@hugeicons/core-free-icons";
  import FavIcon from "../FavIcon/FavIcon.svelte";

  let {
    x,
    y,
    image,
    tone = "mid",
    title = "",
  }: {
    x: number;
    y: number;
    image: ImageData | null;
    tone?: "dark" | "light" | "mid";
    title?: string;
  } = $props();

  const MARGIN = 6;
  // Lifted out of the column, whose own transforms would otherwise become the
  // card's frame of reference.
  function lift(node: HTMLElement) {
    document.body.append(node);
    return { destroy: () => node.remove() };
  }
  // The chrome only shows over its own column; past it a page covers the
  // window, so the card is kept inside the column however far the pointer goes.
  const column = document.querySelector(".browser-sidebar")?.getBoundingClientRect() ?? null;
  const bare = column !== null && column.width < 120;
  let width = $state(0);
  let height = $state(0);

  const left = $derived(
    column === null
      ? x - 18
      : Math.max(column.left + MARGIN, Math.min(x - 18, column.right - width - MARGIN)),
  );
  const top = $derived(
    Math.max(MARGIN, Math.min(y - height / 2, window.innerHeight - height - MARGIN)),
  );
</script>

<!--
  What follows the pointer when a tab is carried away from its list: the
  site's mark and, where the column has room, its title, on a small raised
  card that stays under the pointer. Position is the only thing that changes
  while it moves, by transform alone.
-->
<div
  use:lift
  class="drag-card"
  data-bare={bare || title === "" || undefined}
  style:transform={`translate3d(${left}px, ${top}px, 0)`}
  bind:clientWidth={width}
  bind:clientHeight={height}
  aria-hidden="true"
>
  <FavIcon {image} {tone} size={16} lit fallback={Globe02Icon} />
  {#if title !== "" && !bare}<span class="drag-title">{title}</span>{/if}
</div>

<style>
  .drag-card {
    position: fixed;
    inset: 0 auto auto 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 220px;
    padding: 8px 14px 8px 10px;
    border-radius: var(--radius-row);
    background: var(--color-raised);
    box-shadow: var(--shadow-float);
    color: var(--color-text);
    font-size: var(--sidebar-row-text, 13px);
    pointer-events: none;
    will-change: transform;
    animation: drag-card-in var(--motion-fast) var(--ease-out) backwards;
  }

  .drag-card[data-bare] {
    padding: 7px;
    border-radius: var(--radius-capsule);
  }

  .drag-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @keyframes drag-card-in {
    from {
      opacity: 0;
      scale: 0.9;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .drag-card {
      animation: none;
    }
  }
</style>
