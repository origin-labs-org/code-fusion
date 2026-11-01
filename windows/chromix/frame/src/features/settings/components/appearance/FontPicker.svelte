<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { preferences } from "$domain/preferences";

  const faces = [
    { value: "system", label: m.look_font_system },
    { value: "rounded", label: m.look_font_rounded },
    { value: "serif", label: m.look_font_serif },
    { value: "mono", label: m.look_font_mono },
  ] as const;
  let group: HTMLDivElement;

  function key(event: KeyboardEvent) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const rtl = getComputedStyle(group).direction === "rtl" && event.key.startsWith("Arrow");
    const index = faces.findIndex((face) => face.value === preferences.value("ui.font"));
    const next = faces[(index + (rtl ? -step : step) + faces.length) % faces.length]!;
    void preferences.set("ui.font", next.value);
    group.querySelector<HTMLElement>(`[data-face="${next.value}"]`)?.focus();
  }
</script>

<div class="head" data-setting="appearance.font">
  <h3>{m.look_font()}</h3>
  <p>{m.look_font_desc()}</p>
</div>
<div
  class="faces"
  role="radiogroup"
  aria-label={m.look_font()}
  tabindex="-1"
  bind:this={group}
  onkeydown={key}
>
  {#each faces as face (face.value)}
    {@const chosen = preferences.value("ui.font") === face.value}
    <button
      type="button"
      role="radio"
      class="face"
      aria-checked={chosen}
      tabindex={chosen ? 0 : -1}
      data-face={face.value}
      disabled={preferences.saving() && !chosen}
      onclick={() => void preferences.set("ui.font", face.value)}
    >
      <span class="sample" aria-hidden="true">Aa</span>
      <span class="name">{face.label()}</span>
    </button>
  {/each}
</div>

<style>
  /* The row's own copy, set as a settings row sets it, with the choice
     under it rather than beside it. */
  .head {
    padding: 14px 18px 12px;
  }

  h3 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-page-title);
    font-weight: 500;
    line-height: 19px;
    letter-spacing: -0.008em;
  }

  p {
    margin: 2px 0 0;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
  }

  .faces {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
    padding: 0 18px 18px;
    outline: none;
  }

  /* The hairline a settings row would draw above the next one. */
  .faces::after {
    content: "";
    position: absolute;
    inset-inline: 16px 0;
    bottom: 0;
    height: 1px;
    background: var(--color-border);
  }

  .face {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 74px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-row);
    background: var(--color-fill);
    color: var(--color-label-secondary);
    font: inherit;
    cursor: default;
    transition:
      background-color var(--motion-instant) var(--ease-smooth),
      box-shadow var(--motion-fast) var(--ease-out),
      scale var(--motion-slow) var(--ease-spring);
  }

  .face:hover {
    background: var(--color-fill-hover);
  }

  .face:active {
    scale: 0.97;
  }

  .face:focus-visible {
    outline: none;
    box-shadow:
      0 0 0 2px var(--color-surface),
      0 0 0 3.5px var(--color-ring);
  }

  /* The chosen face lifts the way a segment's thumb does, rather than
     taking a ring. */
  .face[aria-checked="true"] {
    background: var(--row-active);
    box-shadow: var(--shine-top);
    color: var(--color-text);
  }

  .sample {
    color: var(--color-text);
    font-size: 24px;
    line-height: 30px;
    letter-spacing: -0.01em;
  }

  .face[data-face="system"] .sample {
    font-family:
      -apple-system, BlinkMacSystemFont, system-ui, "Segoe UI Variable Text", "Segoe UI", sans-serif;
  }

  .face[data-face="rounded"] .sample {
    font-family:
      ui-rounded,
      "SF Pro Rounded",
      -apple-system,
      "Segoe UI Variable Text",
      "Segoe UI",
      sans-serif;
  }

  .face[data-face="serif"] .sample {
    font-family: ui-serif, "New York", "Iowan Old Style", "Sitka Text", Georgia, serif;
  }

  .face[data-face="mono"] .sample {
    font-family: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  }

  .name {
    font-size: var(--text-label);
  }

  .face[aria-checked="true"] .name {
    font-weight: 600;
  }

  @media (forced-colors: active) {
    .face[aria-checked="true"] {
      outline: 2px solid Highlight;
    }
  }
</style>
