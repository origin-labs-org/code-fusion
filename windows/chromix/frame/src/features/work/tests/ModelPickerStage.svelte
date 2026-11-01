<script lang="ts">
  import ModelPicker from "../components/bar/ModelPicker.svelte";

  let { profile }: { profile: string } = $props();
</script>

<!-- The picker where the bar's trail holds it, at the canvas's bottom edge. The bench's WebKit draws no backdrop blur, so nothing busy sits behind the menu. -->
<div class="stage">
  <div class="card" aria-hidden="true">
    <span class="title">Demo Day, Thursday</span>
    <span class="line"></span>
    <span class="line short"></span>
  </div>
  <div class="sheet">
    <span class="words">Plan my trip to the next YC batch from Warsaw</span>
    <ModelPicker {profile} onsettings={() => {}} />
  </div>
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background-color: var(--color-canvas);
    background-image: radial-gradient(
      circle,
      color-mix(in oklab, var(--color-text) 14%, transparent) 1px,
      transparent 1.4px
    );
    background-size: 22px 22px;
  }

  .card {
    position: absolute;
    inset-block-start: 380px;
    inset-inline-start: 250px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    inline-size: 220px;
    padding: 14px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-float);
  }

  .title {
    color: var(--color-text);
    font-size: 15px;
    font-weight: 600;
  }

  .line {
    block-size: 8px;
    border-radius: 4px;
    background: var(--color-fill-hover);
  }

  .line.short {
    inline-size: 60%;
  }

  .sheet {
    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    box-sizing: border-box;
    inline-size: 700px;
    padding: 8px 8px 10px 16px;
    border-radius: var(--radius-panel) var(--radius-panel) 0 0;
    background: var(--color-menu);
    box-shadow: var(--shadow-sheet);
    backdrop-filter: blur(24px);
  }

  .words {
    flex: 1;
    color: var(--color-text);
    font-size: 14px;
    line-height: 20px;
  }
</style>
