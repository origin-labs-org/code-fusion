<script lang="ts">
  import "$styles/global.css";
  import AssistPanel from "../components/AssistPanel.svelte";
  import FrameStub from "./FrameStub.svelte";

  let {
    profile,
    width = 356,
    height = 760,
    onclose = () => {},
  }: { profile: string; width?: number; height?: number; onclose?: () => void } = $props();
  const draft = $state({
    query: "",
    filter: "all",
    title: "",
    draft: "",
    composing: false,
    submitted: false,
    scrollTop: 0,
  });
</script>

<aside class="browser-sidebar stage" style:inline-size="{width}px" style:block-size="{height}px">
  <AssistPanel
    Frame={FrameStub}
    {profile}
    tool="ai"
    state={draft}
    edit={(patch) => Object.assign(draft, patch)}
    {onclose}
  />
</aside>

<style>
  .stage {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    background: var(--color-chrome);
  }

  :global(:root[data-material="liquid_glass"]) .stage {
    background: transparent;
  }
</style>
