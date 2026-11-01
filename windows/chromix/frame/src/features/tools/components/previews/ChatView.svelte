<script lang="ts">
  import type { ToolHostProps } from "$session/tool-drafts.svelte";
  import { loadAssistPanel } from "$features/assist";
  import LazyView from "$shared/ui/LazyView";
  import * as m from "$shared/i18n/messages";
  import ToolFrame from "../ToolFrame.svelte";
  let viewProps: ToolHostProps = $props();
</script>

<!-- Ask is its own module and its own chunk; the panel only lends it the tool frame. -->
<LazyView
  loader={loadAssistPanel}
  loadingLabel={m.panel_loading()}
  failureLabel={m.panel_load_failed()}
  retryLabel={m.surface_retry()}
  >{#snippet children(Panel)}<Panel {...viewProps} Frame={ToolFrame} />{/snippet}</LazyView
>
