<script lang="ts">
  import { untrack } from "svelte";
  import { accountSession as session, stagedAvatarUrl } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Slider from "$shared/ui/Slider";
  import { explainAccountFault } from "../../lib/account";
  import {
    cropOf,
    fitted,
    framing,
    MAX_ZOOM,
    MIN_ZOOM,
    moved,
    zoomed,
    type Framing,
  } from "../../lib/avatar-crop";
  import AccountDialog from "./AccountDialog.svelte";

  let {
    open = $bindable(false),
    pick,
  }: {
    open?: boolean;
    /** The picture staged natively, and its preview's size in pixels. */
    pick: { token: string; width: number; height: number };
  } = $props();

  /** The frame's side in CSS pixels; the crop is worked out from it. */
  const VIEW = 264;
  const busy = $derived(session.pending());
  let view = $state<Framing>(framing(1, 1, VIEW));
  let saving = $state(false);
  let saved = false;
  let opened = false;
  let failure = $state<string | null>(null);
  let grab = $state<{ pointer: number; x: number; y: number } | null>(null);
  const src = $derived(stagedAvatarUrl(pick.token));
  const shown = $derived(fitted(view));

  // Each opening starts centred on the new picture. Closed without saving,
  // however it was closed, the staged picture is put away and any upload stopped.
  $effect(() => {
    const { token, width, height } = pick;
    if (!open) {
      if (opened && !saved) void session.discardAvatar(token);
      opened = false;
      return;
    }
    untrack(() => {
      opened = true;
      saved = false;
      view = framing(width, height, VIEW);
      saving = false;
      failure = null;
    });
  });

  function down(event: PointerEvent) {
    if (event.button !== 0 || saving) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    grab = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function move(event: PointerEvent) {
    if (!grab || grab.pointer !== event.pointerId) return;
    view = moved(view, event.clientX - grab.x, event.clientY - grab.y);
    grab = { ...grab, x: event.clientX, y: event.clientY };
  }

  function wheel(event: WheelEvent) {
    if (saving) return;
    event.preventDefault();
    view = zoomed(view, view.zoom * Math.exp(-event.deltaY / 400));
  }

  function key(event: KeyboardEvent) {
    if (saving) return;
    const step = event.shiftKey ? 32 : 8;
    const by: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const shift = by[event.key];
    if (shift) view = moved(view, shift[0], shift[1]);
    else if (event.key === "+" || event.key === "=") view = zoomed(view, view.zoom + 0.1);
    else if (event.key === "-") view = zoomed(view, view.zoom - 0.1);
    else return;
    event.preventDefault();
  }

  async function save() {
    if (saving || busy) return;
    saving = true;
    failure = null;
    saved = await session.saveAvatar(pick.token, cropOf(view));
    saving = false;
    if (saved) {
      open = false;
      return;
    }
    if (!open) return;
    const fault = session.fault();
    if (fault?.action === "avatar" && fault.fault !== "avatar_cancelled")
      failure = explainAccountFault(fault.fault, fault.retryAfter);
  }

  function cancel() {
    open = false;
  }
</script>

<AccountDialog
  bind:open
  title={m.account_avatar_crop_title()}
  description={m.account_avatar_crop_desc()}
  width={400}
>
  <form
    class="crop"
    style:--view="{VIEW}px"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex (the arrow keys and +/- are its keyboard) -->
    <div
      class="frame"
      role="application"
      tabindex="0"
      aria-label={m.account_avatar_frame_label()}
      aria-describedby="avatar-crop-help"
      data-grabbing={grab ? "" : undefined}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={() => (grab = null)}
      onpointercancel={() => (grab = null)}
      onwheel={wheel}
      onkeydown={key}
    >
      {#if src}<img
          {src}
          alt=""
          draggable="false"
          style:inline-size="{shown.width}px"
          style:block-size="{shown.height}px"
          style:translate="{view.x}px {view.y}px"
        />{/if}
      <span class="lens" aria-hidden="true"></span>
    </div>
    <p id="avatar-crop-help" class="help">{m.account_avatar_crop_help()}</p>
    <div class="zoom">
      <Slider
        slim
        label={m.account_avatar_zoom()}
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={0.01}
        disabled={saving}
        value={view.zoom}
        format={(zoom) => `${Math.round(zoom * 100)}%`}
        onchange={(zoom) => (view = zoomed(view, zoom))}
      />
    </div>
    {#if failure}<p class="failure" role="alert">{failure}</p>{/if}
    <footer>
      <Button onclick={cancel}>{m.action_cancel()}</Button>
      <Button type="submit" variant="primary" pending={saving} disabled={!!busy && !saving}
        >{m.account_avatar_save()}</Button
      >
    </footer>
  </form>
</AccountDialog>

<style>
  .crop {
    display: grid;
    justify-items: center;
  }

  /* The picture under a round window: what is outside the circle is dimmed,
     not hidden, so the person sees what they are leaving out. */
  .frame {
    position: relative;
    overflow: hidden;
    inline-size: var(--view);
    block-size: var(--view);
    border-radius: var(--radius-card);
    background: var(--color-fill);
    cursor: grab;
    outline: none;
    touch-action: none;
    user-select: none;
  }

  .frame[data-grabbing] {
    cursor: grabbing;
  }

  .frame:focus-visible {
    box-shadow: 0 0 0 2px var(--color-ring);
  }

  img {
    position: absolute;
    top: 0;
    left: 0;
    max-inline-size: none;
    pointer-events: none;
    animation: interface-fade var(--motion-base) var(--ease-out);
  }

  .lens {
    position: absolute;
    border-radius: 50%;
    box-shadow:
      0 0 0 1px var(--avatar-crop-edge),
      0 0 0 999px var(--avatar-veil);
    inset: 0;
    pointer-events: none;
  }

  .help {
    margin: 12px 0 0;
    color: var(--color-muted);
    font-size: var(--text-caption);
    text-align: center;
  }

  .zoom {
    inline-size: var(--view);
    max-inline-size: 100%;
    margin-block-start: 14px;
  }

  .failure {
    justify-self: stretch;
    margin: 14px 0 0;
    color: var(--color-danger);
    font-size: var(--text-label);
    line-height: 1.5;
    text-align: center;
  }

  footer {
    justify-self: stretch;
  }

  @media (prefers-reduced-motion: reduce) {
    img {
      animation: none;
    }
  }
</style>
