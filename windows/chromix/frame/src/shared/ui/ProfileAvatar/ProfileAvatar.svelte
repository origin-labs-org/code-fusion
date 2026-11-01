<script lang="ts" module>
  import {
    Airplane01Icon,
    Book02Icon,
    Briefcase01Icon,
    Building03Icon,
    Camera01Icon,
    CodeIcon,
    Coffee01Icon,
    FavouriteIcon,
    GameController01Icon,
    Home01Icon,
    Leaf01Icon,
    Moon02Icon,
    Mortarboard01Icon,
    MusicNote01Icon,
    PaintBoardIcon,
    Rocket01Icon,
  } from "@hugeicons/core-free-icons";

  /** The curated glyphs, in the order Rust stores their index. */
  export const AVATAR_SYMBOLS = [
    Briefcase01Icon,
    Home01Icon,
    FavouriteIcon,
    Leaf01Icon,
    CodeIcon,
    PaintBoardIcon,
    MusicNote01Icon,
    Camera01Icon,
    Book02Icon,
    Mortarboard01Icon,
    Coffee01Icon,
    GameController01Icon,
    Airplane01Icon,
    Rocket01Icon,
    Moon02Icon,
    Building03Icon,
  ] as const;
  export const AVATAR_COLORS = 10;

  /** Display-only: what to draw, already resolved by the caller. */
  export type ProfileAvatarView = {
    style: "initials" | "symbol" | "photo";
    color: number;
    symbol: number;
    initials: string;
    src: string | null;
  };
</script>

<script lang="ts">
  import Icon from "../Icon";

  let {
    view,
    size = 32,
    label,
  }: { view: ProfileAvatarView; size?: number; label?: string } = $props();
  let broken = $state<string | null>(null);
  const photo = $derived(
    view.style === "photo" && view.src && broken !== view.src ? view.src : null,
  );
  const symbol = $derived(
    view.style === "symbol" ? (AVATAR_SYMBOLS[view.symbol] ?? AVATAR_SYMBOLS[0]) : null,
  );
  const color = $derived(
    Number.isInteger(view.color) && view.color >= 0 && view.color < AVATAR_COLORS ? view.color : 0,
  );
</script>

<span
  class="profile-avatar"
  data-color={color}
  data-photo={photo ? "" : undefined}
  style:--avatar-size={`${size}px`}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
  >{#if photo}<img
      src={photo}
      alt=""
      draggable="false"
      onerror={() => (broken = photo)}
    />{:else if symbol}<Icon
      icon={symbol}
      size={Math.round(size * 0.5)}
      strokeWidth={size >= 40 ? 1.6 : 1.8}
    />{:else}<span class="letters">{view.initials}</span>{/if}</span
>

<style>
  .profile-avatar {
    --avatar-top: var(--avatar-0-top);
    --avatar-bottom: var(--avatar-0-bottom);

    position: relative;
    display: grid;
    flex: none;
    overflow: hidden;
    inline-size: var(--avatar-size);
    block-size: var(--avatar-size);
    border-radius: 50%;
    background: linear-gradient(180deg, var(--avatar-top), var(--avatar-bottom));
    color: var(--avatar-ink);
    place-items: center;
    user-select: none;
  }

  /* A hairline keeps a pale photo or hue from melting into its ground. */
  .profile-avatar::after {
    position: absolute;
    border-radius: inherit;
    box-shadow: inset 0 0 0 0.5px var(--avatar-rim);
    content: "";
    inset: 0;
    pointer-events: none;
  }

  .profile-avatar[data-photo] {
    background: var(--color-fill-strong);
  }

  img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
  }

  .letters {
    font-size: calc(var(--avatar-size) * 0.4);
    font-weight: 600;
    letter-spacing: 0.01em;
    line-height: 1;
  }

  .profile-avatar[data-color="1"] {
    --avatar-top: var(--avatar-1-top);
    --avatar-bottom: var(--avatar-1-bottom);
  }

  .profile-avatar[data-color="2"] {
    --avatar-top: var(--avatar-2-top);
    --avatar-bottom: var(--avatar-2-bottom);
  }

  .profile-avatar[data-color="3"] {
    --avatar-top: var(--avatar-3-top);
    --avatar-bottom: var(--avatar-3-bottom);
  }

  .profile-avatar[data-color="4"] {
    --avatar-top: var(--avatar-4-top);
    --avatar-bottom: var(--avatar-4-bottom);
  }

  .profile-avatar[data-color="5"] {
    --avatar-top: var(--avatar-5-top);
    --avatar-bottom: var(--avatar-5-bottom);
  }

  .profile-avatar[data-color="6"] {
    --avatar-top: var(--avatar-6-top);
    --avatar-bottom: var(--avatar-6-bottom);
  }

  .profile-avatar[data-color="7"] {
    --avatar-top: var(--avatar-7-top);
    --avatar-bottom: var(--avatar-7-bottom);
  }

  .profile-avatar[data-color="8"] {
    --avatar-top: var(--avatar-8-top);
    --avatar-bottom: var(--avatar-8-bottom);
  }

  .profile-avatar[data-color="9"] {
    --avatar-top: var(--avatar-9-top);
    --avatar-bottom: var(--avatar-9-bottom);
  }

  @media (forced-colors: active) {
    .profile-avatar {
      background: Canvas;
      color: CanvasText;
      outline: 1px solid CanvasText;
    }
  }
</style>
