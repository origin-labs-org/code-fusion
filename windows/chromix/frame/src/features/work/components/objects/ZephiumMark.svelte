<script module lang="ts">
  /** Whether a name is Zephium itself, which has no site mark to borrow. */
  export const isZephium = (name: string) => /^zephium\b/iu.test(name.trim());
</script>

<script lang="ts">
  import ZephiumTile from "$shared/ui/ZephiumTile";

  let { size = 16 }: { size?: number } = $props();
</script>

<ZephiumTile {size} />
