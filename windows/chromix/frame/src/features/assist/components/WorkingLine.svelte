<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { Orb, Shimmer } from "$shared/ui/presence";
  import type { PageAssistPhaseV1 } from "$shared/ipc/bindings";

  let { phase }: { phase: PageAssistPhaseV1 | null } = $props();

  const words = $derived.by(() => {
    switch (phase?.phase) {
      case "reading":
        return m.assist_phase_reading({ site: phase.site });
      case "acting":
        return m.assist_phase_acting();
      case "opening":
        return m.assist_phase_opening();
      case "styling":
        return m.assist_phase_styling();
      case "preparing":
        return m.assist_phase_preparing();
      default:
        return m.assist_phase_thinking();
    }
  });
</script>

<p class="working" role="status">
  <Orb size={14} /><span class="words"><Shimmer text={words} /></span>
</p>

<style>
  .working {
    display: flex;
    align-items: center;
    gap: 9px;
    min-block-size: 22px;
    margin: 0;
    color: var(--color-muted);
    font-size: 13.5px;
    line-height: 20px;
  }

  .words {
    --shimmer-rest: var(--color-faint);
    --shimmer-lit: var(--color-text);

    min-inline-size: 0;
  }
</style>
