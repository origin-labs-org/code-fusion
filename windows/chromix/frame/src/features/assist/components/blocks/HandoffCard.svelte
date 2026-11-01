<script lang="ts">
  import type { IconSvgElement } from "@hugeicons/svelte";
  import * as m from "$shared/i18n/messages";
  import { tabs } from "$domain/tabs";
  import { favicons } from "$domain/favicons";
  import FavIcon from "$shared/ui/FavIcon";
  import Icon from "$shared/ui/Icon";
  import { Orb, Shimmer } from "$shared/ui/presence";
  import type { PageAssistBringKindV1, PageAssistHandoffV1 } from "$shared/ipc/bindings";
  import { faultView } from "../../lib/faults";
  import {
    ArrowRight02Icon,
    Briefcase02Icon,
    BrowserIcon,
    CircleIcon,
    Folder01Icon,
    GithubIcon,
    Message01Icon,
    Note01Icon,
  } from "../../lib/icons";
  import "../assist.css";

  let {
    handoff,
    oncontinue,
    ondecline,
    onopen,
  }: {
    handoff: PageAssistHandoffV1;
    oncontinue: () => void;
    ondecline: () => void;
    /** Shows the started Work. */
    onopen: (work: string) => void;
  } = $props();

  const GLYPHS: Record<PageAssistBringKindV1, IconSvgElement> = {
    task: CircleIcon,
    note: Note01Icon,
    tab: BrowserIcon,
    repository: GithubIcon,
    folder: Folder01Icon,
    conversation: Message01Icon,
  };

  const live = $derived(new Map(tabs.tabs().map((tab) => [tab.id, tab])));
  const phase = $derived(handoff.state);
  let pressed = $state(false);
  $effect(() => {
    if (phase.state !== "offered") pressed = false;
  });
</script>

{#if phase.state === "dismissed"}
  <p class="assist-quiet">
    <Icon icon={Briefcase02Icon} size={13} />{m.assist_handoff_dismissed({ title: handoff.title })}
  </p>
{:else}
  <section class="handoff assist-rise" aria-label={m.assist_handoff_label()}>
    <header class="eyebrow">
      <Icon icon={Briefcase02Icon} size={14} />
      <span class="kind">{m.mode_work()}</span>
      {#if phase.state === "offered"}<button
          type="button"
          class="later"
          disabled={pressed}
          onclick={ondecline}>{m.assist_decline()}</button
        >{/if}
    </header>
    <h3 class="title">{handoff.title}</h3>
    <p class="summary">{handoff.summary}</p>
    {#if handoff.brings.length}
      <p class="label">{m.assist_handoff_brings()}</p>
      <ul class="brings">
        {#each handoff.brings as bring, index (index)}
          {@const tab = bring.tab ? live.get(bring.tab) : undefined}
          {@const mark = tab ? favicons.mark(tab.icon, tab.url) : null}
          <li class="bring" data-kind={bring.kind}>
            <span class="glyph" aria-hidden="true">
              {#if bring.kind === "tab" && mark}<FavIcon
                  image={mark.image}
                  tone={mark.tone}
                  size={16}
                />{:else}<Icon icon={GLYPHS[bring.kind]} size={15} />{/if}
            </span>
            <span class="what">{bring.label}</span>
            {#if bring.detail}<span class="detail">{bring.detail}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if phase.state === "started"}
      {@const work = phase.work}
      <button type="button" class="go" onclick={() => onopen(work)}>
        {m.assist_handoff_open()}<Icon icon={ArrowRight02Icon} size={15} strokeWidth={2} />
      </button>
      <p class="foot">{m.assist_handoff_started()}</p>
    {:else if phase.state === "starting"}
      <div class="go" data-busy role="status">
        <Orb size={14} /><span class="busy-words"
          ><Shimmer text={m.assist_handoff_starting()} /></span
        >
      </div>
      <p class="foot">{m.assist_handoff_foot()}</p>
    {:else if phase.state === "failed"}
      <p class="failed" role="alert">{faultView(phase.fault).message}</p>
    {:else}
      <button
        type="button"
        class="go"
        disabled={pressed}
        onclick={() => {
          pressed = true;
          oncontinue();
        }}
      >
        {m.assist_handoff_continue()}<Icon icon={ArrowRight02Icon} size={15} strokeWidth={2} />
      </button>
      <p class="foot">{m.assist_handoff_foot()}</p>
    {/if}
  </section>
{/if}

<style>
  /* The hero of a reply: a sheet lifted off the panel, white in light and the
     raised surface in dark, the one place the thread uses a real shadow. */
  .handoff {
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    padding: 14px 16px 12px;
    border-radius: var(--radius-card);
    background: var(--color-raised);
    box-shadow: var(--shadow-float), var(--shine-top);
    color: var(--color-text);
  }

  .eyebrow {
    display: flex;
    align-items: center;
    gap: 6px;
    min-block-size: 22px;
    color: var(--color-muted);
  }

  .kind {
    flex: 1;
    font-size: 12.5px;
    font-weight: 550;
  }

  .later {
    block-size: 22px;
    margin-inline-end: -6px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: transparent;
    color: var(--color-muted);
    font: inherit;
    font-size: 12px;
    cursor: default;
    transition:
      background-color var(--motion-instant) var(--ease-smooth),
      color var(--motion-instant) var(--ease-smooth);
  }

  .later:focus-visible {
    outline: 2px solid var(--color-ring);
  }

  .later:hover:not(:disabled) {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }

  .title {
    margin: 8px 0 0;
    font-size: 17px;
    font-weight: 620;
    letter-spacing: -0.018em;
    line-height: 1.3;
    text-wrap: balance;
  }

  .summary {
    margin: 5px 0 0;
    color: var(--color-muted);
    font-size: 13.5px;
    line-height: 1.45;
    text-wrap: pretty;
  }

  .label {
    margin: 14px 0 6px;
    color: var(--color-muted);
    font-size: 12px;
    font-weight: 550;
  }

  .brings {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 2px 0;
    border-radius: var(--radius-row);
    background: var(--row-active);
    list-style: none;
  }

  .bring {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    min-block-size: 36px;
    padding: 0 12px;
  }

  .bring + .bring::before {
    position: absolute;
    inset-block-start: 0;
    inset-inline: 38px 12px;
    block-size: 0.5px;
    background: var(--color-border);
    content: "";
  }

  .glyph {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 16px;
    block-size: 16px;
    color: var(--color-muted);
  }

  .bring[data-kind="task"] .glyph {
    scale: 0.82;
  }

  .what {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    font-size: 13.5px;
    line-height: 18px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .detail {
    flex: none;
    max-inline-size: 40%;
    overflow: hidden;
    color: var(--color-faint);
    font-size: 12.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .go {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    box-sizing: border-box;
    inline-size: 100%;
    block-size: 40px;
    margin-block-start: 14px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--radius-row);
    background: var(--color-lit);
    box-shadow: var(--shadow-control);
    color: var(--color-on-lit);
    font: inherit;
    font-size: var(--text-page-title);
    font-weight: 600;
    letter-spacing: -0.006em;
    cursor: default;
    transition:
      background-color var(--motion-instant) var(--ease-smooth),
      scale var(--motion-fast) var(--ease-smooth);
  }

  .go:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .go:disabled {
    opacity: 0.7;
  }

  .go:hover:not(:disabled, [data-busy]) {
    background: var(--color-lit-hover);
  }

  .go:active:not(:disabled, [data-busy]) {
    scale: 0.985;
  }

  .go[data-busy] {
    background: var(--color-fill-strong);
    box-shadow: none;
    color: var(--color-text);
  }

  .busy-words {
    --shimmer-rest: var(--color-muted);
    --shimmer-lit: var(--color-text);

    min-inline-size: 0;
    font-weight: 550;
  }

  .foot {
    margin: 9px 0 2px;
    color: var(--color-faint);
    font-size: 12px;
    line-height: 16px;
    text-align: center;
  }

  .failed {
    margin: 12px 0 2px;
    color: var(--color-warning);
    font-size: 13px;
    line-height: 1.45;
  }

  @media (forced-colors: active) {
    .handoff {
      border: 1px solid CanvasText;
    }

    .go {
      border: 1px solid ButtonText;
    }
  }
</style>
