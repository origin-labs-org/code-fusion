<script lang="ts">
  import type { SpaceFlow } from "../lib/space-flow.svelte";

  let { flow }: { flow: SpaceFlow } = $props();
  // The contents load the first time they open.
  const loadEditor = () => import("./SpaceEditor.svelte");
  const loadSwitcher = () => import("./SpaceSwitcher.svelte");
</script>

{#if flow.editing !== null}
  {#key flow.editing.id}{#await loadEditor() then { default: SpaceEditor }}<SpaceEditor
        space={flow.editing}
        fresh={flow.fresh}
        deletable={flow.spaces.length > 1}
        onclose={(done) => flow.finished(done)}
      />{/await}{/key}
{:else}
  {#await loadSwitcher() then { default: SpaceSwitcher }}<SpaceSwitcher
      spaces={flow.spaces}
      active={flow.active?.id ?? null}
      open={flow.open}
      making={flow.making !== null}
      failed={flow.makeFailed}
      onchoose={(id) => flow.choose(id)}
      onedit={(space, rename) => flow.edit(space.id, rename)}
      onnew={() => void flow.make()}
    />{/await}
{/if}
