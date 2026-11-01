<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import Icon from "$shared/ui/Icon";
  import * as m from "$shared/i18n/messages";
  import type { ListView, ObjectActions } from "../../lib/board/types";
  import MakeTasks from "../board/MakeTasks.svelte";
  import Mark from "./Mark.svelte";
  import Title from "./Title.svelte";
  import Checklist from "./Checklist.svelte";
  import { ArrowUpRight01Icon, Tick02Icon } from "./icons";
  /**
   * Things to do, answer or read, each with where it came from: the app's mark,
   * who and when, the words themselves in a quieter voice, and the way back.
   */
  let {
    object,
    actions = {},
    centre = false,
  }: {
    object: ListView;
    actions?: ObjectActions;
    /** Opened in the centre, where the header makes the tasks. */
    centre?: boolean;
  } = $props();
  const todo = $derived(object.style === "todo");
  /** Practice questions: cards that turn over to their answer in place. */
  const deck = $derived(object.style === "questions");
  const turned = new SvelteSet<number>();
  const turn = (index: number) => {
    if (!turned.delete(index)) turned.add(index);
  };
  const open = (url: string) => (event: MouseEvent) => {
    if (!actions.link) return;
    event.preventDefault();
    actions.link(url);
  };
</script>

{#if actions.edit && todo}<Checklist {object} {actions} />{:else}<section
    class="list"
    class:deck
    aria-label={object.title}
  >
    {#if object.title}<Title text={object.title} />{/if}
    {#if deck}<ol class="cards">
        {#each object.items as item, index (index)}<li>
            <button
              type="button"
              class="card nodrag nopan"
              class:turned={turned.has(index)}
              aria-pressed={turned.has(index)}
              onclick={() => turn(index)}
            >
              <span class="face obverse" aria-hidden={turned.has(index)}>
                <span class="number">{index + 1}</span>
                <span class="question">{item.title}</span>
                {#if item.detail}<span class="hint">{m.work_list_show_answer()}</span>{/if}
              </span>
              <span class="face reverse" aria-hidden={!turned.has(index)}>
                <span class="asked">{item.title}</span>
                <span class="answer">{item.detail ?? ""}</span>
              </span>
            </button>
          </li>{/each}
      </ol>{:else}<ul class="items">
        {#each object.items as item, index (index)}
          <li class:done={item.done}>
            {#if todo}
              {#if actions.check}<button
                  type="button"
                  class="box nodrag nopan"
                  aria-pressed={!!item.done}
                  aria-label={item.title}
                  onclick={() => actions.check?.(object.id, index, !item.done)}
                  >{#if item.done}<Icon icon={Tick02Icon} size={12} />{/if}</button
                >{:else}<span class="box" aria-hidden="true"
                  >{#if item.done}<Icon icon={Tick02Icon} size={12} />{/if}</span
                >{/if}
            {:else}<span class="lead" aria-hidden="true"></span>{/if}
            <div class="body">
              <div class="line">
                <h4>{item.title}</h4>
                {#if item.priority === "high" || item.due}<span class="when">
                    {#if item.priority === "high"}<span class="priority">{m.work_list_high()}</span
                      >{/if}{#if item.due}<span class="due">{item.due}</span>{/if}
                  </span>{/if}
              </div>
              {#if item.detail}<p class="detail">{item.detail}</p>{/if}
              {#if item.from}
                {@const from = item.from}
                <div class="from">
                  {#if from.host}<Mark address={from.host} size={14} />{/if}
                  <span class="who"
                    >{[from.who, from.app, from.when].filter(Boolean).join(" · ")}</span
                  >
                  {#if from.url}<a
                      class="back nodrag"
                      href={from.url}
                      onclick={open(from.url)}
                      title={from.app ? m.work_list_open_in({ app: from.app }) : m.work_env_open()}
                      ><Icon icon={ArrowUpRight01Icon} size={13} /></a
                    >{/if}
                </div>
                {#if from.quote}<blockquote>{from.quote}</blockquote>{/if}
              {/if}
            </div>
          </li>
        {/each}
      </ul>{/if}
    {#if todo && !centre}<footer><MakeTasks id={object.id} /></footer>{/if}
  </section>{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-inline-size: 640px;
    color: var(--color-text);
  }

  .list.deck {
    max-inline-size: 920px;
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .cards li {
    display: flex;
  }

  /* Both faces share one cell: the card is as tall as its longer face from the start, so turning it never moves the canvas. */
  .card {
    display: grid;
    flex: 1;
    padding: 16px 18px;
    border: 0;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-raised);
    color: var(--color-text);
    font: inherit;
    text-align: start;
    cursor: default;
    transition: box-shadow var(--motion-fast) var(--ease-out);
  }

  .card:hover {
    box-shadow:
      0 0 0 1px var(--color-border-strong),
      var(--shadow-raised);
  }

  .card:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .face {
    display: flex;
    grid-area: 1 / 1;
    flex-direction: column;
    gap: 6px;
    transition: opacity var(--motion-base) var(--ease-out);
  }

  .reverse,
  .turned .obverse {
    opacity: 0;
    visibility: hidden;
  }

  .turned .reverse {
    opacity: 1;
    visibility: visible;
  }

  .number {
    color: var(--color-faint);
    font-size: var(--text-caption);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .question {
    font-size: var(--text-body);
    font-weight: 600;
    line-height: 1.4;
    text-wrap: pretty;
  }

  .hint {
    margin-block-start: auto;
    padding-block-start: 6px;
    color: var(--color-muted);
    font-size: var(--text-label);
  }

  .asked {
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.35;
  }

  .answer {
    font-size: var(--text-body);
    line-height: 1.45;
    text-wrap: pretty;
  }

  .items {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .items li {
    display: grid;
    grid-template-columns: 20px minmax(0, 1fr);
    column-gap: 14px;
    padding-block: 14px;
    border-block-start: 1px solid var(--color-border);
  }

  .items li:first-child {
    padding-block-start: 4px;
    border-block-start: 0;
  }

  .box {
    display: grid;
    place-items: center;
    inline-size: 18px;
    block-size: 18px;
    margin-block-start: 1px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-capsule);
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--color-border-strong);
    color: var(--color-surface);
    cursor: default;
  }

  .box:hover {
    box-shadow: inset 0 0 0 1.5px var(--color-muted);
  }

  .done .box {
    background: var(--color-success);
    box-shadow: none;
  }

  .lead {
    inline-size: 6px;
    block-size: 6px;
    margin: 8px auto 0;
    border-radius: var(--radius-capsule);
    background: var(--color-faint);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-inline-size: 0;
  }

  .line {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }

  h4 {
    margin: 0;
    font-size: var(--text-page-title);
    font-weight: 600;
    line-height: 20px;
    text-wrap: pretty;
  }

  .done h4 {
    color: var(--color-muted);
  }

  .when {
    display: inline-flex;
    flex: 0 1 auto;
    flex-wrap: wrap;
    align-items: baseline;
    justify-content: flex-end;
    gap: 4px 8px;
    max-inline-size: 45%;
  }

  .priority {
    padding: 1px 7px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill-strong);
    color: var(--color-text);
    font-size: var(--text-caption);
    font-weight: 600;
    line-height: 16px;
  }

  .due {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
    text-align: end;
  }

  .detail {
    margin: 0;
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    line-height: 19px;
  }

  .from {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--color-muted);
    font-size: var(--text-label);
  }

  .back {
    display: inline-grid;
    place-items: center;
    inline-size: 20px;
    block-size: 20px;
    border-radius: var(--radius-capsule);
    color: var(--color-faint);
    opacity: 0;
    transition: opacity var(--motion-fast) var(--ease-out);
  }

  .back:hover {
    background: var(--color-fill-hover);
    color: var(--color-text);
  }

  .back:focus-visible,
  li:hover .back {
    opacity: 1;
  }

  blockquote {
    margin: 2px 0 0;
    padding-inline-start: 12px;
    border-inline-start: 2px solid var(--color-border-strong);
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    line-height: 19px;
    text-wrap: pretty;
  }

  footer {
    padding-inline-start: 34px;
  }
</style>
