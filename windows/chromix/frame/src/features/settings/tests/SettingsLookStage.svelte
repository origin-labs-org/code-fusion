<script lang="ts">
  import Settings from "../components/Settings.svelte";
  import SettingsNavigation from "../components/SettingsNavigation.svelte";
</script>

<!-- The settings window as the shell lays it out: the panel in the sidebar,
     the page beside it. -->
<div class="stage">
  <div class="browser-sidebar side"><SettingsNavigation /></div>
  <div class="page"><Settings /></div>
</div>

<style>
  .stage {
    position: fixed;
    inset: 0;
    display: flex;
    overflow: hidden;
    background: var(--color-chrome);
  }

  .side {
    display: flex;
    flex-direction: column;
    inline-size: 260px;
  }

  .page {
    flex: 1;
    min-inline-size: 0;
    padding: 8px 8px 8px 0;
  }
</style>
