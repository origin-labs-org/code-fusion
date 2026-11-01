<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import IconButton from "$shared/ui/IconButton";
  import {
    commands,
    type PageAssistDecisionV1,
    type PageStyleProposalV1,
    type PageStyleV1,
  } from "$shared/ipc/bindings";
  import { Delete02Icon, PaintBoardIcon } from "../../lib/icons";
  import "$shared/ui/Shine/shine.css";
  import "../assist.css";

  let {
    style,
    stored,
    ondecide,
    ontoggle,
    onremove,
  }: {
    style: PageStyleProposalV1;
    /** The applied style as its site holds it now: null once removed, undefined while that
     *  site is not the one in front. */
    stored: PageStyleV1 | null | undefined;
    ondecide: (decision: PageAssistDecisionV1) => void;
    ontoggle: (enabled: boolean) => void;
    onremove: () => void;
  } = $props();

  let answered = $state(false);
</script>

{#if style.state === "proposed"}
  <section class="assist-card ui-shine assist-rise" aria-label={m.assist_style_label()}>
    <div class="head">
      <span class="plate" aria-hidden="true"><Icon icon={PaintBoardIcon} size={15} /></span>
      <span class="kind">{m.assist_style_for({ site: style.site })}</span>
    </div>
    <h4>{style.summary}</h4>
    <p>{m.assist_style_scope({ site: style.site })}</p>
    <div class="assist-actions">
      <Button
        variant="primary"
        size="compact"
        disabled={answered}
        onclick={() => {
          answered = true;
          ondecide("approve");
        }}>{m.assist_style_apply()}</Button
      >
      <Button
        variant="ghost"
        size="compact"
        disabled={answered}
        onclick={() => {
          answered = true;
          ondecide("decline");
        }}>{m.assist_style_discard()}</Button
      >
    </div>
  </section>
{:else if style.state === "applied" && stored}
  <div class="badge ui-shine assist-rise" data-on={stored.enabled}>
    <span class="dot" aria-hidden="true"></span>
    <span class="label"
      >{stored.enabled
        ? m.assist_style_on({ site: style.site })
        : m.assist_style_off({ site: style.site })}</span
    >
    <Button variant="ghost" size="compact" onclick={() => ontoggle(!stored.enabled)}
      >{stored.enabled ? m.assist_style_turn_off() : m.assist_style_turn_on()}</Button
    >
    <IconButton
      icon={Delete02Icon}
      size={14}
      buttonSize={28}
      label={m.assist_style_remove()}
      onclick={onremove}
    />
  </div>
{:else if style.state === "applied" && stored === null}
  <p class="assist-quiet">{m.assist_style_removed()}</p>
{:else if style.state === "applied"}
  <div class="badge ui-shine assist-rise" data-on="true">
    <span class="dot" aria-hidden="true"></span>
    <span class="label">{m.assist_style_on({ site: style.site })}</span>
  </div>
{:else if style.state === "full"}
  <div class="full">
    <p class="assist-quiet">{m.assist_style_full()}</p>
    <Button
      variant="ghost"
      size="compact"
      onclick={() => void commands.runCommand("settings.sites").catch(() => {})}
      >{m.assist_style_full_open()}</Button
    >
  </div>
{:else}
  <p class="assist-quiet">
    {style.state === "rejected" ? m.assist_style_failed() : m.assist_style_discarded()}
  </p>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .plate {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 24px;
    block-size: 24px;
    border-radius: var(--radius-inset);
    background: var(--color-field);
    color: var(--color-muted);
  }

  .kind {
    color: var(--color-muted);
    font-size: 12.5px;
  }

  .badge {
    --shine-radius: var(--radius-control);

    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    min-block-size: 40px;
    padding: 4px 4px 4px 12px;
    color: var(--color-label-secondary);
    font-size: 13px;
  }

  .dot {
    flex: none;
    inline-size: 7px;
    block-size: 7px;
    margin-inline-end: 2px;
    border-radius: 50%;
    background: var(--color-faint);
  }

  .badge[data-on="true"] .dot {
    background: var(--color-success);
  }

  .label {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .full {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .full :global(.ui-button) {
    margin-inline-start: -10px;
  }
</style>
