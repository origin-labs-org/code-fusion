<script lang="ts">
  import AttachPanel, { type AttachKind } from "../components/bar/AttachPanel.svelte";

  let kind = $state<AttachKind>("tabs");
</script>

<div class="stage">
  <AttachPanel
    bind:kind
    onaddlink={async () => true}
    onaddfolder={async () => true}
    onchoosefolder={() => {}}
  >
    {#snippet picker()}<div class="tall">Tabs</div>{/snippet}
    {#snippet media(which)}<div class="tall">{which}</div>{/snippet}
  </AttachPanel>
</div>

<style>
  .stage {
    inline-size: 380px;
    padding: 8px;
  }

  .tall {
    block-size: 260px;
  }
</style>
