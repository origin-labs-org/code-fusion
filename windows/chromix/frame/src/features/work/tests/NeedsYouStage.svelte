<script lang="ts">
  // A run held on a bot check, on the real canvas with the island over it.
  import type { WorkSession } from "$domain/work";
  import type { WorkHumanPageV1 } from "$shared/ipc/bindings";
  import AgentLine from "../components/AgentLine.svelte";
  import PartsCanvas from "./PartsCanvas.svelte";
  import type { BoardScene } from "./board-fixtures";
  let {
    scene,
    session,
    held = [],
    waiting = null,
    ended = null,
    viewport,
    onaction,
    onwaitingpage,
  }: {
    scene: BoardScene;
    session: WorkSession;
    held?: WorkHumanPageV1[];
    waiting?: {
      card: string;
      host: string;
      reason: WorkHumanPageV1["reason"];
      remaining: number;
      canExtend?: boolean;
    } | null;
    ended?: { text: string; action: string; onact: () => void } | null;
    viewport: { x: number; y: number; zoom: number };
    onaction?: (id: string, action?: string) => void;
    onwaitingpage?: (card: string) => void;
  } = $props();
</script>

<div class="stage">
  <PartsCanvas {scene} {viewport} {held} {onaction} />
  <div class="island">
    <AgentLine {session} {waiting} {ended} {onwaitingpage} />
  </div>
</div>

<style>
  .stage {
    position: relative;
    inline-size: 100%;
    block-size: 100%;
  }

  .island {
    position: absolute;
    inset-block-start: 12px;
    inset-inline-start: 50%;
    z-index: 10;
    display: flex;
    justify-content: center;
    inline-size: min(560px, 60%);
    translate: -50% 0;
  }
</style>
