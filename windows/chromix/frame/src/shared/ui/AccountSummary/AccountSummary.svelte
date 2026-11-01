<script lang="ts">
  import * as m from "$shared/i18n/messages";

  /**
   * Who is signed in and how much of the included usage is spent: the one
   * picture of the account that the New Tab page and Work's foot both show,
   * so the two cannot drift. Content only; the place that shows it decides
   * whether it is a button.
   */
  let {
    email,
    initials,
    avatar = null,
    plan = null,
    used = null,
    metered = false,
    tone = "calm",
  }: {
    email: string | null;
    initials: string;
    /** The account's own picture, in place of its initials. */
    avatar?: string | null;
    plan?: string | null;
    /** Whole percent of the included usage spent, when known. */
    used?: number | null;
    /** Usage has been read; without a percent it is not part of the plan. */
    metered?: boolean;
    tone?: "calm" | "high" | "full";
  } = $props();

  let broken = $state<string | null>(null);
  const photo = $derived(avatar && avatar !== broken ? avatar : null);
  const fill = $derived(used == null ? 0 : Math.min(100, Math.max(0, used)));
  const reading = $derived(
    used != null
      ? m.ai_cloud_used({ percent: used })
      : metered
        ? m.account_usage_none()
        : m.account_usage_loading(),
  );
</script>

<span class="account-summary" data-tone={tone} style:--fill={fill / 100}>
  <span class="disc" aria-hidden="true"
    >{#if photo}<img
        src={photo}
        alt=""
        draggable="false"
        onerror={() => (broken = photo)}
      />{:else}{initials}{/if}</span
  >
  <span class="who">
    <span class="email">{email}</span>
    {#if plan}<span class="plan">{plan}</span>{/if}
  </span>
  <span class="usage">
    <span class="reading">
      <span class="title">{m.account_usage_title()}</span>
      <span class="value">{reading}</span>
    </span>
    <span
      class="meter"
      role="meter"
      aria-label={m.account_usage_meter()}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={fill}><span class="fill"></span></span
    >
  </span>
</span>

<style>
  .account-summary {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: center;
    gap: 12px 10px;
    min-inline-size: 0;
    text-align: start;
  }

  /* Initials on the menu's own plate rather than a colour: the profiles
     carry the colour, and the account is the same in every one of them. */
  .disc {
    display: grid;
    inline-size: 32px;
    block-size: 32px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill-active);
    box-shadow: var(--shine-top);
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 600;
    letter-spacing: 0.03em;
    place-items: center;
  }

  .disc:has(img) {
    overflow: hidden;
    box-shadow: inset 0 0 0 0.5px var(--avatar-rim);
  }

  .disc img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    animation: interface-fade var(--motion-base) var(--ease-out);
  }

  .who {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-inline-size: 0;
  }

  .email {
    max-inline-size: 100%;
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--text-body);
    font-weight: 550;
    letter-spacing: -0.005em;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan {
    padding-inline: 6px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    box-shadow: var(--row-rim);
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 550;
    letter-spacing: 0.02em;
    line-height: 16px;
  }

  .usage {
    display: grid;
    grid-column: 1 / -1;
    gap: 7px;
  }

  .reading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    font-size: var(--text-label);
    line-height: 16px;
  }

  .title {
    overflow: hidden;
    color: var(--color-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .value {
    flex: none;
    color: var(--color-text);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }

  .account-summary[data-tone="high"] .value {
    color: var(--color-warning);
  }

  .account-summary[data-tone="full"] .value {
    color: var(--color-danger);
  }

  .meter {
    position: relative;
    display: block;
    overflow: hidden;
    block-size: 4px;
    border-radius: var(--radius-capsule);
    background: var(--color-track);
  }

  .fill {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    inline-size: calc(var(--fill) * 100%);
    border-radius: inherit;
    background: var(--color-text);
  }

  /* The meter fills to what has been spent as the panel around it opens. */
  :global([data-open="true"]) .fill {
    animation: account-meter-in var(--motion-page) var(--ease-out) var(--motion-fast) both;
  }

  .account-summary[data-tone="high"] .fill {
    background: var(--color-warning);
  }

  .account-summary[data-tone="full"] .fill {
    background: var(--color-danger);
  }

  /* stylelint-disable-next-line keyframes-name-pattern -- Svelte's global prefix. */
  @keyframes -global-account-meter-in {
    from {
      inline-size: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    :global([data-open="true"]) .fill,
    .disc img {
      animation: none;
    }
  }

  :global(:root[data-reduce-motion="true"] [data-open="true"]) .fill {
    animation: none;
  }

  @media (forced-colors: active) {
    .meter {
      border: 1px solid CanvasText;
    }

    .fill {
      background: CanvasText;
    }
  }
</style>
