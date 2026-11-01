<script lang="ts">
  import WorkBar from "../components/bar/WorkBar.svelte";
  import ModelPicker from "../components/bar/ModelPicker.svelte";

  let { profile }: { profile: string } = $props();
  let value = $state("");
</script>

<div class="stage">
  <WorkBar bind:value placeholder="What do you want to do?" onsubmit={() => {}}>
    {#snippet trailing()}<ModelPicker {profile} onsettings={() => {}} />{/snippet}
  </WorkBar>
</div>

<style>
  .stage {
    display: flex;
    justify-content: center;
    padding-block-start: 300px;
  }
</style>
