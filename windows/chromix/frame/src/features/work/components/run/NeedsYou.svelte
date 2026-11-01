<script lang="ts">
  import Button from "$shared/ui/Button";
  import HostGlyph from "../cards/HostGlyph.svelte";
  import { cardCountdown, needLine, type HumanPage } from "../../lib/work-human";
  import * as m from "$shared/i18n/messages";

  /**
   * What a site asks of the person, over its frame or inline under a part's
   * name: the site, one plain sentence and the one action that meets it. A
   * waiting page adds how long the run still waits; without one, `reason`
   * says what the ended part still needs. Calm by design: only the button is lit.
   */
  let {
    page,
    reason = "challenge",
    host,
    url,
    pending = 0,
    inline = false,
    onopen,
    onwait,
  }: {
    page?: HumanPage;
    reason?: HumanPage["reason"];
    host: string;
    url: string;
    /** Pages of this site waiting, the one the button opens included. */
    pending?: number;
    /** Set in the part's own column instead of lifted over a frame. */
    inline?: boolean;
    onopen?: () => void;
    onwait?: () => void;
  } = $props();
  const line = $derived(needLine(page?.reason ?? reason, host));
  const left = $derived(page ? cardCountdown(page.remaining) : null);
  /** The last stretch says so in the warning tone, never in red: nothing failed yet. */
  const late = $derived(!!page && page.remaining < 20_000);
</script>

<div class="needs nodrag nopan" class:inline role="group" aria-label={line.text}>
  <p class="what">
    <span class="mark"
      >{#if !inline}<HostGlyph {host} {url} size={16} initial={false} />{/if}<i class="dot"
      ></i></span
    >
    <span class="title">{line.text}</span>
  </p>
  <div class="row">
    {#if onopen}<Button
        size="compact"
        shape="capsule"
        variant="primary"
        onclick={(event: MouseEvent) => {
          event.stopPropagation();
          onopen?.();
        }}>{line.action}</Button
      >{/if}
    {#if page?.canExtend && onwait}<Button
        size="compact"
        shape="capsule"
        variant="ghost"
        title={m.work_human_extend_hint()}
        onclick={(event: MouseEvent) => {
          event.stopPropagation();
          onwait?.();
        }}>{m.work_human_extend()}</Button
      >{/if}
    {#if left}<span class="left" class:late role="timer" aria-live="off">{left}</span>{/if}
  </div>
  {#if pending > 1}<p class="more">{m.work_need_pending({ count: pending, host })}</p>{/if}
</div>

<style>
  .needs {
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-sizing: border-box;
    padding: 10px 10px 10px 12px;
    border-radius: var(--radius-row);
    background: var(--color-float);
    box-shadow: var(--shadow-menu);
    color: var(--color-text);
    cursor: default;
    animation: needs-arrive var(--motion-fast) var(--ease-out) both;
  }

  .what {
    display: flex;
    align-items: center;
    gap: 8px;
    min-inline-size: 0;
    margin: 0;
  }

  .mark {
    position: relative;
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 16px;
    block-size: 16px;
  }

  /* The one sign something is asked of the person: small, amber, never red. */
  .dot {
    position: absolute;
    inset-block-start: -2px;
    inset-inline-end: -3px;
    inline-size: 6px;
    block-size: 6px;
    border-radius: var(--radius-capsule);
    background: var(--color-warning);
  }

  .title {
    overflow: hidden;
    font-size: var(--text-body);
    font-weight: 600;
    line-height: 18px;
    letter-spacing: -0.005em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    min-block-size: var(--control-compact);
    padding-inline-start: 24px;
  }

  .more {
    margin: 0;
    padding-inline-start: 24px;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 16px;
  }

  .left {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
    line-height: 16px;
    white-space: nowrap;
    transition: color var(--motion-base) var(--ease-out);
  }

  .left.late {
    color: var(--color-warning);
  }

  /* In the part's column it belongs to the row: no card, the text column's own indent. */
  .inline {
    gap: 6px;
    padding: 0;
    border-radius: 0;
    background: none;
    box-shadow: none;
    animation: none;
  }

  .inline .what {
    align-items: flex-start;
    gap: 7px;
  }

  /* The part's own name already carries the site's mark: only the amber dot stands in its gutter. */
  .inline .mark {
    inline-size: 16px;
    block-size: 16px;
  }

  .inline .dot {
    inset-block-start: 5px;
    inset-inline: 3px auto;
  }

  .inline .title {
    overflow: visible;
    font-size: var(--text-label);
    font-weight: 500;
    line-height: 16px;
    text-wrap: pretty;
    white-space: normal;
  }

  .inline .row,
  .inline .more {
    padding-inline-start: 23px;
  }

  @keyframes needs-arrive {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .needs {
      animation: none;
    }
  }
</style>
