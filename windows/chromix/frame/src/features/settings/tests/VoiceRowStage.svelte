<script lang="ts">
  import AiVoiceRow from "../components/AiVoiceRow.svelte";
</script>

<!-- The Settings shell's own page frame around the group, as Settings.svelte draws it. -->
<section class="settings-shell" style="height: 100vh">
  <div class="settings-content scrolls">
    <div class="settings-page">
      <div class="settings-view">
        <AiVoiceRow />
      </div>
    </div>
  </div>
</section>
