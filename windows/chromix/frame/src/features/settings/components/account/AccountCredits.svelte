<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { accountSession as session, creditsLeft, priceLabel } from "$domain/account";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import { packsInOrder, sharedLifetime, type TopUpOffer } from "../../lib/plans";
  import AccountDialog from "./AccountDialog.svelte";

  let {
    open = $bindable(false),
    packs,
    per,
    custom,
  }: {
    open?: boolean;
    packs: readonly TopUpOffer[];
    /** Units in one credit, when the server states it. */
    per: string | null;
    /** An amount of the person's own, once the service can sell one; the packs stay beside it. */
    custom?: Snippet;
  } = $props();

  const busy = $derived(session.pending());
  const ordered = $derived(packsInOrder(packs));
  /** Said once in the description when every pack lasts as long; otherwise on each. */
  const lifetime = $derived(sharedLifetime(packs));
  let chosen = $state<string | null>(null);
  let buying = $state(false);
  const pack = $derived(ordered.find((offer) => offer.id === chosen) ?? ordered[0] ?? null);

  $effect(() => {
    if (!open) return;
    untrack(() => {
      buying = false;
      chosen = ordered[0]?.id ?? null;
    });
  });

  const amount = (offer: TopUpOffer) => creditsLeft(offer.units, per);
  const price = (offer: TopUpOffer) => priceLabel(offer.price);

  const action = $derived.by(() => {
    if (!pack) return "";
    const credits = amount(pack);
    const cost = price(pack);
    if (credits && cost) return m.account_credits_buy_action({ amount: credits, price: cost });
    return cost ? m.account_credits_buy_price({ price: cost }) : m.account_topup_buy();
  });

  async function buy() {
    if (!pack || buying || busy) return;
    buying = true;
    await session.buy({ kind: "top_up", id: pack.id });
    buying = false;
    open = false;
  }
</script>

<AccountDialog
  bind:open
  title={m.account_credits_title()}
  description={lifetime ? m.account_topup_desc_days({ days: lifetime }) : m.account_topup_desc()}
  width={460}
>
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void buy();
    }}
  >
    <!-- Native radios: the arrow keys, the group's one tab stop and its announcement are the browser's. -->
    <fieldset class="packs" data-solo={ordered.length === 1 || undefined}>
      <legend class="hidden">{m.account_credits_packs()}</legend>
      {#each ordered as offer (offer.id)}
        {@const credits = amount(offer)}
        <label class="pack">
          <input type="radio" name="pack" value={offer.id} bind:group={chosen} />
          <span class="mark" aria-hidden="true"></span>
          <span class="what">
            <span class="credits"
              >{credits ?? offer.name ?? m.account_topup_title()}{#if credits}<span class="unit"
                  >{m.account_credits_unit()}</span
                >{/if}</span
            >
            {#if !lifetime && offer.expires_days}<span class="lasts"
                >{m.account_credits_lasts({ days: offer.expires_days })}</span
              >{/if}
          </span>
          <span class="cost">{price(offer) ?? ""}</span>
        </label>
      {/each}
    </fieldset>
    {#if custom}{@render custom()}{/if}
    <p class="tax">{m.account_prices_before_tax()}</p>
    <footer>
      <Button onclick={() => (open = false)} disabled={buying}>{m.action_cancel()}</Button>
      <Button type="submit" variant="primary" pending={buying} disabled={!pack || !!busy}
        >{action}</Button
      >
    </footer>
  </form>
</AccountDialog>

<style>
  /* A list to choose from, one row a pack: the credits lead, the price follows. */
  .packs {
    display: grid;
    gap: 6px;
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .hidden {
    position: absolute;
    overflow: hidden;
    inline-size: 1px;
    block-size: 1px;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .pack {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    min-block-size: 56px;
    box-sizing: border-box;
    padding: 10px 18px 10px 16px;
    border-radius: var(--radius-control);
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-border);
    cursor: default;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      box-shadow var(--motion-fast) var(--ease-out);
  }

  .pack:hover {
    background: var(--row-hover);
  }

  .pack:has(input:checked) {
    background: var(--color-accent-soft);
    box-shadow: inset 0 0 0 1.5px var(--color-accent);
  }

  .pack:has(input:focus-visible) {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .pack input {
    position: absolute;
    opacity: 0;
    inset: 0;
    margin: 0;
    pointer-events: none;
  }

  /* The radio, drawn: a ring that fills with the accent when chosen. */
  .mark {
    display: grid;
    inline-size: 18px;
    block-size: 18px;
    box-sizing: border-box;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px var(--color-border-strong);
    place-items: center;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      box-shadow var(--motion-fast) var(--ease-out);
  }

  .mark::after {
    inline-size: 6px;
    block-size: 6px;
    border-radius: 50%;
    background: var(--color-on-accent);
    content: "";
    scale: 0;
    transition: scale var(--motion-fast) var(--ease-out);
  }

  .pack:has(input:checked) .mark {
    background: var(--color-accent);
    box-shadow: none;
  }

  .pack:has(input:checked) .mark::after {
    scale: 1;
  }

  .what {
    display: grid;
    gap: 1px;
    min-inline-size: 0;
  }

  .credits {
    overflow: hidden;
    color: var(--color-text);
    font-size: 17px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 22px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .unit {
    margin-inline-start: 5px;
    color: var(--color-muted);
    font-size: var(--text-label);
    font-weight: 500;
    letter-spacing: 0;
  }

  .lasts {
    color: var(--color-faint);
    font-size: var(--text-caption);
  }

  .cost {
    color: var(--color-label-secondary);
    font-size: var(--text-body);
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .pack:has(input:checked) .cost {
    color: var(--color-text);
  }

  /* One pack is not a choice to make: no radio, no selection, just the line. */
  .packs[data-solo] .pack {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .packs[data-solo] .pack .mark {
    display: none;
  }

  .packs[data-solo] .pack:has(input:checked) {
    background: var(--color-surface);
    box-shadow: inset 0 0 0 1px var(--color-border);
  }

  .packs[data-solo] .pack .cost {
    color: var(--color-text);
    font-size: 17px;
    font-weight: 600;
  }

  .tax {
    margin: 14px 2px 0;
    color: var(--color-faint);
    font-size: var(--text-caption);
    line-height: 1.5;
  }

  .tax + footer {
    margin-block-start: 22px;
  }

  @media (prefers-reduced-motion: reduce) {
    .pack,
    .mark,
    .mark::after {
      transition: none;
    }
  }

  @media (forced-colors: active) {
    .pack:has(input:checked) {
      outline: 2px solid Highlight;
    }

    .mark {
      border: 1px solid CanvasText;
    }
  }
</style>
