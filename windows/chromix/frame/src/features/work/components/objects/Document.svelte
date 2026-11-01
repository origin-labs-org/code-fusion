<script lang="ts">
  import DocumentView from "$shared/ui/data/Artifact/DocumentView.svelte";
  import * as m from "$shared/i18n/messages";
  import type { DocumentObjectView, ObjectActions } from "../../lib/board/types";
  import Inline from "./Inline.svelte";
  import { noteBlocks } from "./markdown";
  /** Text the person asked for, set as a sheet of paper: its first page on the canvas. */
  let {
    object,
    actions = {},
    centre = false,
  }: {
    object: DocumentObjectView;
    actions?: ObjectActions;
    /** Opened in the centre: all of it, at reading size. */
    centre?: boolean;
  } = $props();
  /** Plain paragraphs a model wrote in Markdown read as the headings and lists it meant. */
  const written = $derived(
    object.content.formatted ? [] : noteBlocks(object.content.paragraphs.join("\n\n")),
  );
  let body = $state<HTMLElement>();
  let width = $state(0);
  let overflows = $state(false);
  $effect(() => {
    const element = body;
    if (!element) return;
    const check = () => (overflows = element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  });
</script>

<article class="paper" class:centre aria-label={object.title}>
  <div
    class="page"
    class:overflows
    bind:this={body}
    bind:clientWidth={width}
    style:max-block-size={width && !centre ? `${Math.round(width * 1.294)}px` : undefined}
    style:min-block-size={width && !centre ? `${Math.round(width * 0.72)}px` : undefined}
  >
    {#if object.title}<h2>{object.title}</h2>{/if}
    <div class="text">
      {#if object.content.formatted}<DocumentView
          document={object.content.formatted}
          onlink={actions.link}
        />{:else}{#each written as part, index (index)}{#if part.kind === "heading"}<h3>
              <Inline text={part.text} plain />
            </h3>{:else if part.kind === "list"}<svelte:element this={part.ordered ? "ol" : "ul"}
              >{#each part.items as item, at (at)}<li>
                  <Inline text={item} plain />
                </li>{/each}</svelte:element
            >{:else}<p><Inline text={part.lines.join(" ")} plain /></p>{/if}{/each}{/if}
    </div>
  </div>
  {#if overflows && !centre}<button
      type="button"
      class="read nodrag nopan"
      onclick={() => actions.open?.(object.id)}>{m.work_object_read_all()}</button
    >{/if}
</article>

<style>
  .paper {
    position: relative;
    box-sizing: border-box;
    inline-size: 100%;
    border-radius: var(--radius-inset);
    background: var(--color-raised);
    box-shadow: var(--shadow-float);
    color: var(--color-text);
  }

  .page {
    box-sizing: border-box;
    padding: 44px 48px;
    overflow: hidden;
  }

  /* Opened, the lift is the sheet: the page loses its own paper and margins. */
  .paper.centre {
    background: none;
    box-shadow: none;
  }

  .centre .page {
    padding: 8px 0 16px;
  }

  .page.overflows {
    mask-image: var(--mask-fade-bottom);
  }

  h2 {
    margin: 0 0 18px;
    font-size: var(--text-title);
    font-weight: 700;
    line-height: 1.2;
    letter-spacing: -0.02em;
    text-wrap: balance;
  }

  .text {
    max-inline-size: 62ch;
    color: var(--color-label-secondary);
    font-size: var(--text-page-title);
    line-height: 1.6;
    hyphens: auto;
    text-wrap: pretty;
  }

  .text :global(p) {
    margin: 0 0 12px;
  }

  .text :global(h3),
  .text :global(h4) {
    margin: 22px 0 8px;
    color: var(--color-text);
    font-size: calc(var(--text-page-title) + 2px);
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .text :global(h3:first-child),
  .text :global(h4:first-child) {
    margin-block-start: 0;
  }

  .text :global(ul),
  .text :global(ol) {
    margin: 0 0 12px;
    padding-inline-start: 22px;
  }

  .text :global(ul) {
    list-style: disc;
  }

  .text :global(ol) {
    list-style: decimal;
  }

  .text :global(li) {
    margin-block-end: 4px;
  }

  .text :global(li::marker) {
    color: var(--color-faint);
  }

  .read {
    position: absolute;
    inset-block-end: 16px;
    inset-inline-start: 48px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 600;
    cursor: default;
  }

  .read:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
</style>
