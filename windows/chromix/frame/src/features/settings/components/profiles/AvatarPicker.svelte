<script lang="ts" module>
  /** A picker's working choice. `photo` names a staged pick; a saved photo
   *  that is kept has none. */
  export type AvatarChoice = {
    style: "initials" | "symbol" | "photo";
    color: number;
    symbol: number;
    photo: string | null;
  };
</script>

<script lang="ts">
  import { Camera01Icon } from "@hugeicons/core-free-icons";
  import { initialsOf, profiles, stagedUrl } from "$domain/profiles";
  import * as m from "$shared/i18n/messages";
  import Icon from "$shared/ui/Icon";
  import ProfileAvatar, { AVATAR_COLORS, AVATAR_SYMBOLS } from "$shared/ui/ProfileAvatar";

  let {
    value = $bindable(),
    name,
    saved = null,
  }: {
    value: AvatarChoice;
    name: string;
    /** The profile's current photo, while it keeps one. */
    saved?: string | null;
  } = $props();

  let picking = $state(false);
  let refused = $state(false);
  const initials = $derived(initialsOf(name) || "?");
  const photoSrc = $derived(value.photo ? stagedUrl(value.photo) : saved);
  const preview = $derived({
    style: value.style === "photo" && !photoSrc ? ("initials" as const) : value.style,
    color: value.color,
    symbol: value.symbol,
    initials,
    src: photoSrc,
  });

  async function choosePhoto() {
    if (picking) return;
    picking = true;
    refused = false;
    const pick = await profiles.pickPhoto();
    picking = false;
    if (typeof pick === "object") value = { ...value, style: "photo", photo: pick.token };
    else if (pick !== "cancelled") refused = true;
  }

  const choose = (patch: Partial<AvatarChoice>) => {
    refused = false;
    value = { ...value, ...patch };
  };
</script>

<div class="picker">
  <div class="stage">
    <ProfileAvatar view={preview} size={72} />
    <div class="stage-actions">
      <button
        type="button"
        class="photo"
        aria-busy={picking || undefined}
        disabled={picking}
        onclick={() => void choosePhoto()}
      >
        <Icon icon={Camera01Icon} size={15} />
        <span>{photoSrc ? m.profiles_avatar_change_photo() : m.profiles_avatar_choose_photo()}</span
        >
      </button>
      {#if refused}<p class="refused" role="alert">{m.profiles_avatar_unsupported()}</p>{/if}
    </div>
  </div>

  <fieldset>
    <legend>{m.profiles_avatar_symbols()}</legend>
    <div class="tiles">
      {#if photoSrc}<button
          type="button"
          class="tile tile-photo"
          aria-pressed={value.style === "photo"}
          aria-label={m.profiles_avatar_photo()}
          onclick={() => choose({ style: "photo" })}><img src={photoSrc} alt="" /></button
        >{/if}
      <button
        type="button"
        class="tile"
        data-color={value.color}
        aria-pressed={value.style === "initials"}
        aria-label={m.profiles_avatar_initials()}
        onclick={() => choose({ style: "initials" })}
        ><span class="letters">{initials}</span></button
      >
      {#each AVATAR_SYMBOLS as icon, index (index)}<button
          type="button"
          class="tile"
          data-color={value.color}
          aria-pressed={value.style === "symbol" && value.symbol === index}
          aria-label={m.profiles_avatar_symbol({ index: index + 1 })}
          onclick={() => choose({ style: "symbol", symbol: index })}
          ><Icon {icon} size={17} strokeWidth={1.7} /></button
        >{/each}
    </div>
  </fieldset>

  <fieldset class="colors" disabled={value.style === "photo" && !!photoSrc}>
    <legend>{m.profiles_avatar_colors()}</legend>
    <div class="swatches">
      {#each { length: AVATAR_COLORS } as _, index (index)}<button
          type="button"
          class="swatch"
          aria-pressed={value.color === index}
          aria-label={m.profiles_avatar_color({ index: index + 1 })}
          onclick={() =>
            choose({ color: index, style: value.style === "photo" ? "initials" : value.style })}
          ><ProfileAvatar
            view={{ style: "initials", color: index, symbol: 0, initials: "", src: null }}
            size={22}
          /></button
        >{/each}
    </div>
  </fieldset>
</div>

<style>
  .picker {
    display: grid;
    gap: 20px;
  }

  .stage {
    display: flex;
    align-items: center;
    gap: 18px;
  }

  .stage-actions {
    display: grid;
    justify-items: start;
    gap: 6px;
    min-inline-size: 0;
  }

  .photo {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    block-size: 30px;
    padding-inline: 12px;
    border: 0;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-label);
    font-weight: 500;
    transition: background-color var(--motion-fast) var(--ease-out);
  }

  .photo:hover:not(:disabled) {
    background: var(--color-fill-strong);
  }

  .refused {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--text-caption);
    line-height: 1.4;
  }

  fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-block-end: 9px;
    padding: 0;
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 500;
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(36px, 1fr));
    gap: 6px;
  }

  .tile {
    display: grid;
    aspect-ratio: 1;
    border: 0;
    border-radius: 50%;
    background: var(--color-fill);
    color: var(--color-label-secondary);
    place-items: center;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out),
      scale var(--motion-fast) var(--ease-out);
  }

  .tile:hover {
    background: var(--color-fill-strong);
    color: var(--color-text);
  }

  .tile:active {
    scale: 0.94;
  }

  .tile[aria-pressed="true"] {
    background: linear-gradient(180deg, var(--tile-top), var(--tile-bottom));
    color: var(--avatar-ink);
  }

  .tile-photo {
    overflow: hidden;
    padding: 0;
  }

  .tile-photo img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .tile-photo[aria-pressed="true"] {
    box-shadow:
      0 0 0 2px var(--color-raised),
      0 0 0 4px var(--color-text);
  }

  .letters {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .colors:disabled .swatches {
    opacity: 0.4;
  }

  .swatch {
    display: grid;
    padding: 3px;
    border: 0;
    border-radius: 50%;
    background: none;
    place-items: center;
  }

  .swatch[aria-pressed="true"] {
    box-shadow: inset 0 0 0 1.5px var(--color-text);
  }

  .tile[data-color="0"] {
    --tile-top: var(--avatar-0-top);
    --tile-bottom: var(--avatar-0-bottom);
  }

  .tile[data-color="1"] {
    --tile-top: var(--avatar-1-top);
    --tile-bottom: var(--avatar-1-bottom);
  }

  .tile[data-color="2"] {
    --tile-top: var(--avatar-2-top);
    --tile-bottom: var(--avatar-2-bottom);
  }

  .tile[data-color="3"] {
    --tile-top: var(--avatar-3-top);
    --tile-bottom: var(--avatar-3-bottom);
  }

  .tile[data-color="4"] {
    --tile-top: var(--avatar-4-top);
    --tile-bottom: var(--avatar-4-bottom);
  }

  .tile[data-color="5"] {
    --tile-top: var(--avatar-5-top);
    --tile-bottom: var(--avatar-5-bottom);
  }

  .tile[data-color="6"] {
    --tile-top: var(--avatar-6-top);
    --tile-bottom: var(--avatar-6-bottom);
  }

  .tile[data-color="7"] {
    --tile-top: var(--avatar-7-top);
    --tile-bottom: var(--avatar-7-bottom);
  }

  .tile[data-color="8"] {
    --tile-top: var(--avatar-8-top);
    --tile-bottom: var(--avatar-8-bottom);
  }

  .tile[data-color="9"] {
    --tile-top: var(--avatar-9-top);
    --tile-bottom: var(--avatar-9-bottom);
  }

  @media (prefers-reduced-motion: reduce) {
    .tile {
      transition: none;
    }
  }
</style>
