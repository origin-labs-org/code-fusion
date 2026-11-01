<script lang="ts">
  let {
    label,
    hexLabel,
    value,
    invalidLabel,
    onchange,
  }: {
    label: string;
    hexLabel: string;
    /** Lowercase `#rrggbb`. */
    value: string;
    /** Said when typed text is not a colour. */
    invalidLabel: string;
    /** Every change, including each step of a drag in the system picker. */
    onchange: (value: string) => void;
  } = $props();
  const uid = $props.id();
  let typed = $state<string | null>(null);
  let invalid = $state(false);

  function normalize(text: string): string | null {
    const hex = text.trim().toLowerCase().replace(/^#?/, "#");
    if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
    if (/^#[0-9a-f]{3}$/.test(hex)) return `#${[...hex.slice(1)].map((d) => d + d).join("")}`;
    return null;
  }

  function commit() {
    if (typed === null) return;
    const next = normalize(typed);
    invalid = next === null;
    if (next === null) return;
    typed = null;
    if (next !== value) onchange(next);
  }

  function key(event: KeyboardEvent) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape" && typed !== null) {
      event.preventDefault();
      typed = null;
      invalid = false;
    }
  }
</script>

<!-- The system's own picker opens from the swatch; the hex beside it takes
     typing and pasting. -->
<div class="well" data-invalid={invalid} style:--well={value}>
  <span class="swatch">
    <input
      type="color"
      {value}
      aria-label={label}
      oninput={(event) => {
        typed = null;
        invalid = false;
        onchange(event.currentTarget.value);
      }}
    />
  </span>
  <span class="hash" aria-hidden="true">#</span>
  <input
    class="hex"
    type="text"
    spellcheck="false"
    autocomplete="off"
    maxlength="7"
    size="7"
    aria-label={hexLabel}
    aria-invalid={invalid || undefined}
    aria-describedby={invalid ? `${uid}-error` : undefined}
    value={typed ?? value.slice(1).toUpperCase()}
    oninput={(event) => {
      typed = event.currentTarget.value;
      invalid = false;
    }}
    onblur={() => {
      commit();
      if (invalid) {
        typed = null;
        invalid = false;
      }
    }}
    onkeydown={key}
  />
  {#if invalid}<span id={`${uid}-error`} class="sr-only" role="alert">{invalidLabel}</span>{/if}
</div>

<style>
  .well {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    box-sizing: border-box;
    height: var(--field-height);
    padding-inline: 4px 2px;
    border-radius: var(--radius-capsule);
    background: var(--color-field);
    transition: box-shadow var(--motion-instant) var(--ease-smooth);
  }

  .well:focus-within {
    box-shadow: var(--shadow-field-focus);
  }

  .well[data-invalid="true"] {
    box-shadow: inset 0 0 0 1px var(--color-danger);
  }

  .swatch {
    position: relative;
    flex: none;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--well);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--color-text) 14%, transparent),
      inset 0 1px 0 color-mix(in srgb, white 18%, transparent);
    transition: scale var(--motion-fast) var(--ease-snap);
  }

  .swatch:active {
    scale: 0.92;
  }

  .swatch:has(:focus-visible) {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  /* The native control stays the click target and the picker it opens; only
     its own drawing is hidden. */
  .swatch input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: default;
  }

  .hash {
    padding-inline-start: 7px;
    color: var(--color-faint);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .hex {
    box-sizing: border-box;
    width: 8ch;
    height: 100%;
    padding: 0 10px 0 1px;
    border: 0;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    outline: none;
  }

  @media (forced-colors: active) {
    .well {
      border: 1px solid ButtonText;
    }
  }
</style>
