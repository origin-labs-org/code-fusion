<script lang="ts">
  import type { Snippet } from "svelte";
  import type { ChartEvidence } from "./chart";
  import type { Readout as Reading } from "./plan";
  import type { Hover } from "./hover.svelte";
  import Readout from "./Readout.svelte";

  /** The readout floating over the plot at a point, kept inside the plot's width. */
  let {
    readout,
    x,
    y,
    width,
    hover,
    indicator = "dot",
    onevidence,
    glyph,
  }: {
    readout: Reading;
    /** The point it stands over, in the plot's pixels. */
    x: number;
    y: number;
    width: number;
    hover: Hover;
    indicator?: "dot" | "line";
    onevidence?: (reference: ChartEvidence) => void;
    glyph?: Snippet<[ChartEvidence]>;
  } = $props();
  let wide = $state(0);
  let tall = $state(0);
  const left = $derived(Math.max(0, Math.min(x - wide / 2, width - wide)));
  /** Above the point while there is room, else below it. */
  const top = $derived(y - tall - 10 >= -8 ? y - tall - 10 : y + 14);
</script>

<div
  class="tip"
  role="presentation"
  style:left={`${left}px`}
  style:top={`${top}px`}
  bind:clientWidth={wide}
  bind:clientHeight={tall}
  onpointerenter={() => hover.hold()}
  onpointerleave={() => hover.hide()}
>
  <Readout {readout} {indicator} {onevidence} {glyph} />
</div>

<style>
  .tip {
    position: absolute;
    z-index: 2;
    animation: tip-in var(--motion-fast) var(--ease-out) both;
  }

  @keyframes tip-in {
    from {
      opacity: 0;
      transform: translateY(2px);
    }
  }
</style>
