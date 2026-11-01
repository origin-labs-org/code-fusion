<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { cubicOut } from "svelte/easing";

  let {
    view,
    order = 0,
    children,
  }: {
    /** What is showing: a change of it slides the next view in over the last. */
    view: string;
    /** Where the view stands among its siblings, so it comes from the side it lies on. */
    order?: number;
    children: Snippet;
  } = $props();

  let height = $state<number>();
  let settled = $state(false);
  let shown = untrack(() => order);

  const still = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.dataset.reduceMotion === "true";
  const side = () => (order >= shown ? 1 : -1);

  const watching = new WeakMap<HTMLElement, ResizeObserver>();
  function measure(node: HTMLElement) {
    const observer = new ResizeObserver(() => {
      height = node.offsetHeight;
      if (!settled) requestAnimationFrame(() => (settled = true));
    });
    observer.observe(node);
    watching.set(node, observer);
    return { destroy: () => observer.disconnect() };
  }

  function leave(node: HTMLElement) {
    watching.get(node)?.disconnect();
    const dx = still() ? 0 : -10 * side();
    return {
      duration: still() ? 1 : 140,
      easing: cubicOut,
      css: (t: number) =>
        `position:absolute;inset-block-start:0;inset-inline:0;opacity:${t};translate:${(1 - t) * dx}px 0`,
    };
  }

  function enter(_node: HTMLElement) {
    const dx = still() ? 0 : 14 * side();
    shown = order;
    return {
      duration: still() ? 1 : 260,
      delay: still() ? 0 : 70,
      easing: cubicOut,
      css: (t: number) => `opacity:${t};translate:${(1 - t) * dx}px 0`,
    };
  }
</script>

<!-- One place that holds a view at a time: the next slides in as the last slides out, and the place grows or shrinks to it. -->
<div
  class="morph"
  data-settled={settled ? "" : undefined}
  style:block-size={height === undefined ? undefined : `${height}px`}
>
  {#key view}<div class="view" use:measure in:enter out:leave>{@render children()}</div>{/key}
</div>

<style>
  .morph {
    position: relative;
    overflow: clip;
    overflow-clip-margin: 2px;
  }

  .morph[data-settled] {
    transition: block-size var(--motion-slow) var(--ease-emphasized);
  }

  .view {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .morph[data-settled] {
      transition: none;
    }
  }
</style>
