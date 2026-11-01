<script lang="ts">
  import { tick } from "svelte";
  import {
    Camera01Icon,
    Delete02Icon,
    Image02Icon,
    PencilEdit02Icon,
  } from "@hugeicons/core-free-icons";
  import {
    accountSession as session,
    avatarUrl,
    initials,
    planName,
    type AvatarPick,
  } from "$domain/account";
  import { identityAvatar } from "$domain/profiles";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Disclosure from "$shared/ui/Disclosure";
  import Field from "$shared/ui/Field";
  import Icon from "$shared/ui/Icon";
  import ProfileAvatar from "$shared/ui/ProfileAvatar";
  import { explainAccountFault } from "../../lib/account";
  import type AccountAvatarCrop from "./AccountAvatarCrop.svelte";
  import AccountEmail from "./AccountEmail.svelte";

  const account = $derived(session.account());
  const busy = $derived(session.pending());
  const fault = $derived(session.fault());
  const plan = $derived(planName(account?.plan));
  // The account is the same in every browser profile, so its picture is never a profile's.
  const photo = $derived(avatarUrl(account?.avatar));
  const avatar = $derived(identityAvatar(null, initials(account?.email, account?.name), photo));
  /** The framing step loads when a picture is first chosen. */
  let Crop = $state.raw<typeof AccountAvatarCrop | null>(null);
  let picked = $state.raw<Exclude<AvatarPick, string> | null>(null);
  let cropping = $state(false);
  let picking = $state(false);
  let refused = $state(false);
  let editing = $state(false);
  let name = $state("");
  let form = $state<HTMLFormElement | null>(null);
  let opener = $state<HTMLButtonElement | null>(null);
  const faultText = $derived(
    fault?.action === "name" || fault?.action === "avatar_remove"
      ? explainAccountFault(fault.fault, fault.retryAfter)
      : null,
  );

  async function choosePhoto() {
    if (picking || busy) return;
    picking = true;
    refused = false;
    session.clearFault();
    const [pick] = await Promise.all([
      session.pickAvatar(),
      Crop ? null : import("./AccountAvatarCrop.svelte").then((module) => (Crop = module.default)),
    ]);
    picking = false;
    if (typeof pick === "object") {
      picked = pick;
      cropping = true;
    } else if (pick === "unsupported") refused = true;
  }

  function removePhoto() {
    refused = false;
    void session.removeAvatar();
  }

  async function start() {
    session.clearFault();
    name = account?.name ?? "";
    editing = true;
    await tick();
    form?.querySelector("input")?.select();
  }

  async function stop() {
    editing = false;
    await tick();
    opener?.focus();
  }

  async function save() {
    const trimmed = name.trim();
    if (await session.setName(trimmed ? trimmed : null)) await stop();
  }
</script>

{#snippet face()}<ProfileAvatar view={avatar} size={56} /><span class="lens" aria-hidden="true"
    ><Icon icon={Camera01Icon} size={18} strokeWidth={1.8} /></span
  >{/snippet}

<header class="account-identity">
  {#if photo}<Disclosure
      label={m.account_avatar_change()}
      triggerTitle={m.account_avatar_change()}
      menu
      triggerClass="account-avatar"
      panelClass="account-avatar-menu"
    >
      {#snippet trigger()}{@render face()}{/snippet}
      <button
        type="button"
        role="menuitem"
        class="ui-menu-item row"
        onclick={() => void choosePhoto()}
        ><span class="ui-menu-icon"><Icon icon={Image02Icon} size={16} /></span
        >{m.account_avatar_replace()}</button
      >
      <button
        type="button"
        role="menuitem"
        class="ui-menu-item row"
        data-danger="true"
        onclick={removePhoto}
        ><span class="ui-menu-icon"><Icon icon={Delete02Icon} size={16} /></span
        >{m.account_avatar_remove()}</button
      >
    </Disclosure>
  {:else}<button
      type="button"
      class="account-avatar"
      aria-label={m.account_avatar_add()}
      title={m.account_avatar_add()}
      aria-busy={picking || busy === "avatar_remove" || undefined}
      disabled={picking}
      onclick={() => void choosePhoto()}>{@render face()}</button
    >{/if}
  <div class="who">
    {#if editing}<form
        class="editor"
        bind:this={form}
        onsubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field
          label={m.account_name_title()}
          labelHidden
          autocomplete="name"
          placeholder={m.account_name_add()}
          maxlength={100}
          bind:value={name}
          onkeydown={(event) => {
            if (event.key === "Escape") void stop();
          }}
        />
        <Button size="compact" variant="ghost" onclick={() => void stop()}
          >{m.account_name_cancel()}</Button
        >
        <Button size="compact" variant="primary" type="submit" pending={busy === "name"}
          >{m.account_name_save()}</Button
        >
      </form>
    {:else}<div class="name">
        <h2>{account?.name ?? account?.email}</h2>
        <button
          type="button"
          class="edit"
          bind:this={opener}
          disabled={!!busy}
          aria-label={m.account_name_edit_label()}
          title={m.account_name_edit_label()}
          onclick={() => void start()}><Icon icon={PencilEdit02Icon} size={15} /></button
        >
      </div>{/if}
    <p>
      {#if account?.name}<span class="email">{account.email}</span>{/if}
      {#if plan}<span class="plan">{m.account_identity_plan({ plan })}</span>{/if}
    </p>
    {#if faultText}<p class="error" role="alert">{faultText}</p>{/if}
    {#if refused}<p class="error" role="alert">{m.account_avatar_unsupported()}</p>{/if}
  </div>
  {#if !editing}<AccountEmail />{/if}
</header>
{#if Crop && picked}<Crop bind:open={cropping} pick={picked} />{/if}

<style>
  /* The picture is the way to change it: a quiet lens over it on hover, and
     the pointer and focus ring every other control here has. */
  :global(.account-avatar) {
    position: relative;
    display: grid;
    flex: none;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    cursor: default;
    outline: none;
    transition: scale var(--motion-slow) var(--ease-spring);
  }

  :global(.account-avatar:active) {
    scale: 0.96;
    transition-duration: var(--motion-instant);
  }

  :global(.account-avatar:focus-visible) {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
  }

  .lens {
    position: absolute;
    display: grid;
    border-radius: 50%;
    background: var(--avatar-lens);
    color: var(--avatar-ink);
    opacity: 0;
    inset: 0;
    place-items: center;
    transition: opacity var(--motion-fast) var(--ease-out);
  }

  :global(.account-avatar:hover) .lens,
  :global(.account-avatar:focus-visible) .lens,
  :global(.account-avatar[data-state="open"]) .lens,
  :global(.account-avatar[aria-busy="true"]) .lens {
    opacity: 1;
  }

  /* Solid, as the New Tab's account panel is: the page's own words lie
     right under it, and words over words through glass read as neither. */
  :global(.account-avatar-menu.ui-disclosure-panel) {
    top: calc(100% + 8px);
    background: var(--color-float);
    backdrop-filter: none;
    inline-size: max-content;
    min-inline-size: 190px;
  }

  .row {
    inline-size: 100%;
    border: 0;
    background: transparent;
    font: inherit;
    font-size: var(--text-body);
    text-align: start;
  }

  .row:hover,
  .row:focus-visible {
    outline: none;
    background: var(--row-active);
  }

  .row[data-danger="true"]:hover,
  .row[data-danger="true"]:focus-visible {
    background: color-mix(in srgb, var(--color-danger) 16%, transparent);
  }

  .account-identity {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 0 2px 30px;
  }

  .who {
    display: grid;
    flex: 1;
    gap: 4px;
    min-inline-size: 0;
  }

  .name {
    display: flex;
    align-items: center;
    gap: 6px;
    min-inline-size: 0;
  }

  h2 {
    overflow: hidden;
    margin: 0;
    color: var(--color-text);
    font-size: 21px;
    font-weight: 600;
    line-height: 1.25;
    letter-spacing: -0.022em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .edit {
    display: grid;
    flex: none;
    inline-size: 26px;
    block-size: 26px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-faint);
    place-items: center;
    transition:
      background-color var(--motion-fast) var(--ease-out),
      color var(--motion-fast) var(--ease-out);
  }

  .edit:hover:not(:disabled) {
    background: var(--row-hover);
    color: var(--color-text);
  }

  .editor {
    display: flex;
    align-items: center;
    gap: 8px;
    max-inline-size: 440px;
  }

  .editor :global(.ui-field) {
    flex: 1;
  }

  p {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--color-muted);
    font-size: var(--text-body);
  }

  .email {
    overflow: hidden;
    min-inline-size: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan {
    padding: 2px 8px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    color: var(--color-label-secondary);
    font-size: var(--text-caption);
    font-weight: 600;
    letter-spacing: 0.01em;
  }

  .error {
    color: var(--color-danger);
    font-size: var(--text-label);
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.account-avatar),
    .lens {
      transition: none;
    }
  }
</style>
