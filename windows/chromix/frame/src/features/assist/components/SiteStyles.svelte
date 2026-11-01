<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import Icon from "$shared/ui/Icon";
  import IconButton from "$shared/ui/IconButton";
  import Switch from "$shared/ui/Switch";
  import type { AssistSession } from "../lib/assist-session.svelte";
  import { ArrowLeft01Icon, Delete02Icon } from "../lib/icons";

  let { session, onback }: { session: AssistSession; onback: () => void } = $props();

  $effect(() => {
    void session.readStyles();
  });

  const view = $derived(session.styles);
  const site = $derived(view?.site ?? session.status?.page?.host ?? null);
</script>

<section class="sheet" aria-label={m.assist_styles_of({ site: site ?? m.assist_this_page() })}>
  <header>
    <button type="button" class="back" onclick={onback}
      ><Icon icon={ArrowLeft01Icon} size={15} strokeWidth={1.9} />{m.assist_styles_of({
        site: site ?? m.assist_this_page(),
      })}</button
    >
  </header>
  {#if view && !view.site}
    <p class="empty">{m.assist_styles_none_here()}</p>
  {:else if view && view.styles.length === 0}
    <p class="empty">{m.assist_styles_site_empty({ site: view.site ?? "" })}</p>
  {:else if view}
    <ul class="rows">
      {#each view.styles as style (style.id)}
        <li class="row">
          <span class="summary">{style.summary}</span>
          <Switch
            label={style.summary}
            labelHidden
            checked={style.enabled}
            onchange={(enabled) => void session.toggleStyle(style.id, enabled)}
          />
          <IconButton
            icon={Delete02Icon}
            size={14}
            buttonSize={26}
            label={m.assist_style_remove()}
            onclick={() => void session.removeStyle(style.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .sheet {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-block-size: 0;
    overflow: auto;
    padding: 0 10px 12px;
  }

  header {
    padding: 0 0 6px;
  }

  .back {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-inline-size: 100%;
    block-size: 28px;
    padding: 0 10px 0 6px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: 13px;
    font-weight: 550;
    cursor: default;
  }

  .back:hover {
    background: var(--color-fill-hover);
  }

  .back:focus-visible {
    outline: 2px solid var(--color-ring);
  }

  .empty {
    margin: 0;
    padding: 18px 8px;
    color: var(--color-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  .rows {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-block-size: 44px;
    padding: 0 2px 0 10px;
  }

  .row + .row {
    border-block-start: 0.5px solid var(--color-border);
  }

  .summary {
    flex: 1;
    min-inline-size: 0;
    overflow: hidden;
    font-size: 13.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
