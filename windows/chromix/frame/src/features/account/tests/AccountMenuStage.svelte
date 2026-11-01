<script lang="ts">
  import "$styles/global.css";
  import AccountButton from "../components/AccountButton.svelte";
</script>

<!-- The rail's foot in Work, with the canvas beside it for the menu to open onto. -->
<div class="stage">
  <div class="browser-sidebar column">
    <div class="rest"></div>
    <AccountButton name="Ada Lovelace" />
  </div>
  <div class="canvas"></div>
</div>

<style>
  .stage {
    display: flex;
    inline-size: 460px;
    block-size: 360px;
    background: var(--color-canvas);
  }

  .column {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    box-sizing: border-box;
    inline-size: 56px;
    padding-block-end: 10px;
    background: var(--color-chrome);
  }

  .rest {
    flex: 1;
  }

  .canvas {
    flex: 1;
  }
</style>
