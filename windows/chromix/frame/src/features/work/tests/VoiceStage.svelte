<script lang="ts">
  import WorkBar from "../components/bar/WorkBar.svelte";

  let { value = $bindable("") }: { value?: string } = $props();
</script>

<!-- The ask bar on the canvas's bottom edge, as the Work screen docks it. -->
<div class="stage">
  <div class="canvas">
    <div class="dock">
      <WorkBar bind:value placeholder="Ask for anything" onsubmit={() => {}} />
    </div>
  </div>
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    padding: 8px 8px 0;
    background: var(--color-chrome);
  }

  .canvas {
    position: relative;
    block-size: 100%;
    overflow: hidden;
    border-radius: var(--content-radius) var(--content-radius) 0 0;
    background: var(--color-canvas);
  }

  .dock {
    position: absolute;
    inset: auto 0 0;
    display: flex;
    justify-content: center;
  }
</style>
