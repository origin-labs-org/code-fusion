<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { palette, type Mode, type Seeds } from "$domain/appearance";
  import type { ThemeEditor } from "../../lib/theme-editor.svelte";

  let { editor, mode }: { editor: ThemeEditor; mode: Mode } = $props();

  type Card = { id: string; name: string; seeds: Seeds; from?: string };
  let cards = $derived.by((): Card[] => {
    const list: Card[] = palette.presets.map((entry) => ({
      id: entry.id,
      name: entry.name,
      seeds: entry[mode],
    }));
    const custom = editor.custom;
    if (custom)
      list.push({
        id: palette.CUSTOM_THEME,
        name: m.look_custom(),
        seeds: custom[mode],
        from: custom.from ? palette.preset(custom.from)?.name : undefined,
      });
    return list;
  });
  let grid: HTMLDivElement;

  // A radio group: one tab stop, arrows move the choice.
  function key(event: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowRight: 1,
      ArrowDown: columns(),
      ArrowLeft: -1,
      ArrowUp: -columns(),
    };
    let step = steps[event.key];
    if (step === undefined) return;
    if (getComputedStyle(grid).direction === "rtl" && Math.abs(step) === 1) step = -step;
    event.preventDefault();
    const index = cards.findIndex((card) => card.id === editor.selected);
    const next = cards[Math.min(cards.length - 1, Math.max(0, index + step))];
    if (!next || next.id === editor.selected) return;
    editor.choose(next.id);
    grid.querySelector<HTMLElement>(`[data-theme-id="${next.id}"]`)?.focus();
  }

  function columns(): number {
    return getComputedStyle(grid).gridTemplateColumns.split(" ").length;
  }
</script>

<div
  class="gallery"
  role="radiogroup"
  aria-label={m.look_theme()}
  tabindex="-1"
  bind:this={grid}
  onkeydown={key}
  data-setting="appearance.palette"
>
  {#each cards as card (card.id)}
    {@const chosen = editor.selected === card.id}
    <button
      type="button"
      role="radio"
      class="card"
      aria-checked={chosen}
      tabindex={chosen ? 0 : -1}
      data-theme-id={card.id}
      onclick={() => editor.choose(card.id)}
    >
      <span
        class="swatch"
        style:--bg={card.seeds.bg}
        style:--fg={card.seeds.fg}
        style:--accent={card.seeds.accent}
        aria-hidden="true"
      >
        <span class="glyph">Aa</span><span class="caret"></span>
      </span>
      <span class="name">{card.name}</span>
      {#if card.from}<span class="from">{m.look_based_on({ name: card.from })}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 14px 12px;
    padding: 18px;
    outline: none;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-label-secondary);
    font: inherit;
    font-size: var(--text-label);
    cursor: default;
  }

  .card:focus-visible {
    outline: none;
  }

  /* The theme as type: its ink on its ground, and its accent as the caret
     that would follow what you write. */
  .swatch {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    box-sizing: border-box;
    width: 100%;
    aspect-ratio: 1.6;
    border-radius: var(--radius-row);
    background: var(--bg);
    box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--fg) 12%, transparent);
    transition:
      box-shadow var(--motion-fast) var(--ease-out),
      scale var(--motion-slow) var(--ease-spring);
  }

  .card:active .swatch {
    scale: 0.97;
  }

  .glyph {
    color: var(--fg);
    font-size: 19px;
    font-weight: 500;
    line-height: 1;
    letter-spacing: -0.02em;
  }

  .caret {
    width: 2px;
    height: 20px;
    border-radius: 1px;
    background: var(--accent);
  }

  @media (prefers-reduced-motion: no-preference) {
    .card:hover .caret {
      animation: caret 1.1s steps(1, end) infinite;
    }
  }

  @keyframes caret {
    50% {
      opacity: 0;
    }
  }

  /* Chosen: a gap in the card's own colour, then the lit ring, which is ink
     in light. */
  .card[aria-checked="true"] .swatch {
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--fg) 12%, transparent),
      0 0 0 2px var(--color-surface),
      0 0 0 3.5px var(--color-lit);
  }

  .card:focus-visible .swatch {
    box-shadow:
      inset 0 0 0 1px color-mix(in oklab, var(--fg) 12%, transparent),
      0 0 0 2px var(--color-surface),
      0 0 0 3.5px var(--color-ring);
  }

  .name {
    max-width: 100%;
    overflow: hidden;
    line-height: 15px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card[aria-checked="true"] .name {
    color: var(--color-text);
    font-weight: 600;
  }

  .from {
    margin-block-start: -5px;
    color: var(--color-faint);
    font-size: var(--text-caption);
    line-height: 14px;
  }

  @media (forced-colors: active) {
    .card[aria-checked="true"] .swatch {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
</style>
