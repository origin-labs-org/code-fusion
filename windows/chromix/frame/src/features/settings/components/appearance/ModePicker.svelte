<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { preferences } from "$domain/preferences";
  import { palette, type ThemeSpec } from "$domain/appearance";

  let {
    spec,
    contrast,
    glass,
    tint,
  }: {
    spec: ThemeSpec;
    contrast: number;
    /** The window is made of a translucent material, so the column shows what is behind it. */
    glass: boolean;
    /** The material's tint, 0 to 100. */
    tint: number;
  } = $props();

  const modes = [
    { value: "light", label: m.theme_light, tones: ["light"] },
    { value: "dark", label: m.theme_dark, tones: ["dark"] },
    { value: "system", label: m.theme_system, tones: ["light", "dark"] },
  ] as const;

  let seeds = $derived(
    Object.entries(palette.seedVars(spec, contrast))
      .map(([name, value]) => `${name}:${value}`)
      .join(";"),
  );
  let group: HTMLDivElement;

  // A radio group: one tab stop, arrows move the choice.
  function key(event: KeyboardEvent) {
    let step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    if (getComputedStyle(group).direction === "rtl" && event.key.endsWith("Arrow")) step = -step;
    event.preventDefault();
    const index = modes.findIndex((mode) => mode.value === preferences.value("appearance"));
    const next = modes[(index + step + modes.length) % modes.length] ?? modes[0];
    void preferences.set("appearance", next.value);
    group.querySelector<HTMLElement>(`[data-mode="${next.value}"]`)?.focus();
  }
</script>

<div
  class="modes"
  role="radiogroup"
  aria-label={m.settings_color_scheme()}
  tabindex="-1"
  bind:this={group}
  onkeydown={key}
  data-setting="appearance.theme"
>
  {#each modes as mode (mode.value)}
    {@const chosen = preferences.value("appearance") === mode.value}
    <button
      type="button"
      role="radio"
      class="mode"
      aria-checked={chosen}
      tabindex={chosen ? 0 : -1}
      data-mode={mode.value}
      onclick={() => void preferences.set("appearance", mode.value)}
    >
      <span class="picture" aria-hidden="true">
        {#each mode.tones as tone (tone)}
          <span
            class="scene"
            data-theme-scope
            data-theme={tone}
            data-glass={glass}
            style={seeds}
            style:--tint={tint}
          >
            <span class="window">
              <span class="column">
                <span class="lights"><i></i><i></i><i></i></span>
                <span class="tab"><i></i><b style:--w="62%"></b></span>
                <span class="tab current"><i></i><b style:--w="74%"></b></span>
                <span class="tab"><i></i><b style:--w="48%"></b></span>
              </span>
              <span class="page">
                <b class="line title"></b>
                <b class="line" style:--w="92%"></b>
                <b class="line" style:--w="78%"></b>
                <b class="line faint" style:--w="56%"></b>
                <span class="card"></span>
              </span>
            </span>
          </span>
        {/each}
      </span>
      <span class="label">{mode.label()}</span>
    </button>
  {/each}
</div>

<style>
  .modes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    padding: 18px 18px 16px;
    outline: none;
  }

  .mode {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--color-label-secondary);
    font: inherit;
    font-size: var(--text-label);
    cursor: default;
  }

  .mode:focus-visible {
    outline: none;
  }

  .mode[aria-checked="true"] {
    color: var(--color-text);
    font-weight: 600;
  }

  .picture {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1.8;
    border-radius: var(--radius-row);
    transition:
      box-shadow var(--motion-fast) var(--ease-out),
      scale var(--motion-slow) var(--ease-spring);
  }

  .mode:active .picture {
    scale: 0.985;
  }

  .mode[aria-checked="true"] .picture {
    box-shadow:
      0 0 0 2px var(--color-surface),
      0 0 0 3.5px var(--color-lit);
  }

  .mode:focus-visible .picture {
    box-shadow:
      0 0 0 2px var(--color-surface),
      0 0 0 3.5px var(--color-ring);
  }

  /* One scene is a window on a calm ground, in the theme's own tokens. System
     is both: the dark scene takes the lower right of the light one. */
  .scene {
    --ground: linear-gradient(
      160deg,
      color-mix(
        in oklab,
        var(--seed-accent) 6%,
        color-mix(in oklab, var(--seed-fg) 9%, var(--seed-bg))
      ),
      color-mix(in oklab, var(--seed-bg) 82%, black)
    );

    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    container-type: inline-size;
    background:
      radial-gradient(
        46% 70% at 20% 64%,
        color-mix(in oklab, var(--seed-accent) 16%, transparent),
        transparent
      ),
      var(--ground);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  .scene[data-theme="light"] {
    --ground: linear-gradient(
      160deg,
      color-mix(in oklab, var(--seed-accent) 8%, color-mix(in oklab, var(--seed-bg) 90%, white)),
      color-mix(in oklab, var(--seed-bg) 90%, var(--seed-fg))
    );
  }

  .scene + .scene {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  .window {
    position: absolute;
    inset: 15cqw 9cqw -8cqw;
    display: grid;
    grid-template-columns: 31% 1fr;
    overflow: hidden;
    border-start-start-radius: 3.2cqw;
    border-start-end-radius: 3.2cqw;
    background: var(--color-chrome);
    box-shadow:
      0 0 0 0.5px color-mix(in srgb, var(--seed-fg) 16%, transparent),
      0 3cqw 8cqw color-mix(in srgb, black 30%, transparent);
  }

  /* Over a material the column is the frost the system draws, so the ground
     comes through it; solid, it is the chrome itself. */
  .scene[data-glass="true"] .window {
    background: color-mix(in srgb, var(--color-chrome) calc(34% + var(--tint) * 0.4%), transparent);
    box-shadow:
      0 0 0 0.5px color-mix(in srgb, var(--seed-fg) 20%, transparent),
      inset 0 0.5px 0 color-mix(in srgb, var(--seed-fg) 28%, transparent),
      0 3cqw 8cqw color-mix(in srgb, black 26%, transparent);
  }

  .column {
    display: flex;
    flex-direction: column;
    gap: 1.2cqw;
    padding: 2.6cqw 2.4cqw;
  }

  .lights {
    display: flex;
    gap: 1.3cqw;
    margin-block-end: 1.4cqw;
    padding-inline-start: 0.8cqw;
  }

  .lights i {
    inline-size: 1.7cqw;
    block-size: 1.7cqw;
    border-radius: 50%;
    background: color-mix(in srgb, var(--seed-fg) 24%, transparent);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 1.8cqw;
    block-size: 5.2cqw;
    padding-inline: 1.9cqw;
    border-radius: 1.8cqw;
  }

  .tab i {
    flex: none;
    inline-size: 2.2cqw;
    block-size: 2.2cqw;
    border-radius: 0.7cqw;
    background: var(--color-faint);
  }

  .tab b {
    inline-size: var(--w);
    block-size: 1.5cqw;
    border-radius: 1cqw;
    background: var(--color-muted);
  }

  .tab.current {
    background: var(--row-active);
    box-shadow: var(--row-rim);
  }

  .tab.current b {
    background: var(--color-text);
    opacity: 0.8;
  }

  .page {
    display: flex;
    flex-direction: column;
    gap: 2cqw;
    margin: 1.4cqw 0 0;
    padding: 5cqw 5.4cqw;
    border-start-start-radius: 2.2cqw;
    background: var(--color-page);
  }

  .line {
    display: block;
    inline-size: var(--w);
    block-size: 1.5cqw;
    border-radius: 1cqw;
    background: var(--color-muted);
    opacity: 0.7;
  }

  .line.faint {
    background: var(--color-faint);
  }

  .title {
    --w: 46%;

    block-size: 2.6cqw;
    margin-block-end: 1.2cqw;
    border-radius: 1.2cqw;
    background: var(--color-text);
    opacity: 0.85;
  }

  .card {
    block-size: 11cqw;
    margin-block-start: 1.6cqw;
    border-radius: 2.2cqw;
    background: var(--color-surface);
    box-shadow: var(--shadow-card);
  }

  @media (forced-colors: active) {
    .mode[aria-checked="true"] .picture {
      outline: 2px solid Highlight;
      outline-offset: 2px;
    }
  }
</style>
