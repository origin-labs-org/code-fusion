<script lang="ts">
  import { tick } from "svelte";
  import Icon from "$shared/ui/Icon";
  import * as m from "$shared/i18n/messages";
  import type { ListView, ObjectActions, OwnedData } from "../../lib/board/types";
  import { Tick02Icon } from "./icons";
  /** The person's own checklist: ticked, renamed and grown in place, written as they go. */
  let { object, actions }: { object: ListView; actions: ObjectActions } = $props();
  type Item = Extract<OwnedData, { kind: "list" }>["items"][number];
  let root = $state<HTMLElement>();
  let adding = $state("");
  const done = $derived(object.items.filter((item) => item.done).length);

  function change(items: (current: Item[]) => Item[]) {
    actions.edit?.(object.id, (data) =>
      data.kind === "list" ? { ...data, items: items([...data.items]) } : data,
    );
  }
  async function focus(index: number) {
    await tick();
    const field = root?.querySelector<HTMLInputElement>(`[data-item="${index}"]`);
    field?.focus();
    field?.setSelectionRange(field.value.length, field.value.length);
  }
  const toggle = (index: number) =>
    change((items) =>
      items.map((item, at) => (at === index ? { ...item, done: !item.done } : item)),
    );
  function rename(index: number, title: string) {
    const text = title.trim();
    if (text === object.items[index]?.title) return;
    change((items) =>
      text
        ? items.map((item, at) => (at === index ? { ...item, title: text } : item))
        : items.filter((_, at) => at !== index),
    );
  }
  function keyed(event: KeyboardEvent, index: number) {
    const field = event.currentTarget as HTMLInputElement;
    if (event.key === "Enter") {
      event.preventDefault();
      const text = field.value.trim();
      if (!text) return;
      change((items) => {
        const next = items.map((item, at) => (at === index ? { ...item, title: text } : item));
        next.splice(index + 1, 0, { title: "" } as Item);
        return next;
      });
      void focus(index + 1);
    } else if (event.key === "Backspace" && !field.value) {
      event.preventDefault();
      change((items) => items.filter((_, at) => at !== index));
      void focus(Math.max(0, index - 1));
    } else if (event.key === "Escape") field.blur();
  }
  function add(event: KeyboardEvent) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const text = adding.trim();
    if (!text) return;
    change((items) => [...items, { title: text } as Item]);
    adding = "";
  }
</script>

<section class="checklist" bind:this={root} aria-label={object.title}>
  <header>
    {#if object.title}<h3>{object.title}</h3>{/if}
    {#if object.items.length}<span class="count">{done}/{object.items.length}</span>{/if}
  </header>
  <ul>
    {#each object.items as item, index (index)}<li class:done={item.done}>
        <button
          type="button"
          class="box nodrag nopan"
          aria-pressed={!!item.done}
          aria-label={item.title}
          onclick={() => toggle(index)}
          >{#if item.done}<Icon icon={Tick02Icon} size={12} />{/if}</button
        >
        <input
          class="text nodrag nopan"
          data-item={index}
          value={item.title}
          aria-label={item.title}
          onblur={(event) => rename(index, event.currentTarget.value)}
          onkeydown={(event) => keyed(event, index)}
        />
      </li>{/each}
  </ul>
  <label class="add">
    <span class="box ghost" aria-hidden="true"></span>
    <input
      class="text nodrag nopan"
      placeholder={m.work_block_add_item()}
      bind:value={adding}
      onkeydown={add}
    />
  </label>
</section>

<style>
  .checklist {
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-sizing: border-box;
    inline-size: 100%;
    padding: 16px 18px 14px;
    border-radius: var(--radius-card);
    background: var(--color-surface);
    box-shadow: var(--shadow-raised);
    color: var(--color-text);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  h3 {
    margin: 0;
    font-size: var(--text-object-title);
    font-weight: 650;
    letter-spacing: -0.012em;
  }

  .count {
    color: var(--color-muted);
    font-size: var(--text-label);
    font-variant-numeric: tabular-nums;
  }

  ul {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li,
  .add {
    display: flex;
    align-items: center;
    gap: 10px;
    min-block-size: 32px;
  }

  .box {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 18px;
    block-size: 18px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-capsule);
    background: transparent;
    box-shadow: inset 0 0 0 1.5px var(--color-border-strong);
    color: var(--color-surface);
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      box-shadow var(--motion-fast) var(--ease-out);
  }

  button.box:hover {
    box-shadow: inset 0 0 0 1.5px var(--color-muted);
  }

  button.box:focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .done .box {
    background: var(--color-success);
    box-shadow: none;
  }

  .box.ghost {
    box-shadow: inset 0 0 0 1.5px var(--color-border);
  }

  .text {
    flex: 1;
    min-inline-size: 0;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--text-page-title);
    line-height: 20px;
    outline: none;
  }

  .text::placeholder {
    color: var(--color-faint);
  }

  .done .text {
    color: var(--color-muted);
    text-decoration: line-through;
  }
</style>
