<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { tabs } from "$domain/tabs";
  import { favicons } from "$domain/favicons";
  import FavIcon from "$shared/ui/FavIcon";
  import IconButton from "$shared/ui/IconButton";
  import SettingsGroup from "$shared/ui/SettingsGroup";
  import Switch from "$shared/ui/Switch";
  import Globe02Icon from "@hugeicons/core-free-icons/Globe02Icon";
  import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
  import { commands, type PageSiteStylesV1 } from "$shared/ipc/bindings";

  const profile = $derived(tabs.profile());
  let sites = $state.raw<PageSiteStylesV1[] | null>(null);
  let failed = $state(false);
  let busy = $state(false);

  $effect(() => {
    const id = profile && profile.kind !== "incognito" ? profile.id : null;
    if (!id) return;
    let live = true;
    commands.pageStylesAll(id).then(
      (view) => {
        if (live) sites = view.sites;
      },
      () => {
        if (live) failed = true;
      },
    );
    return () => {
      live = false;
    };
  });

  const rows = $derived(
    (sites ?? []).flatMap((entry) => entry.styles.map((style) => ({ site: entry.site, ...style }))),
  );

  async function change(action: () => Promise<{ sites: PageSiteStylesV1[] }>) {
    if (busy) return;
    busy = true;
    failed = false;
    try {
      sites = (await action()).sites;
    } catch {
      failed = true;
    } finally {
      busy = false;
    }
  }
</script>

{#if profile && profile.kind !== "incognito" && (sites !== null || failed)}
  <SettingsGroup title={m.assist_styles_title()} description={m.assist_styles_help()}>
    {#if sites && rows.length === 0}<p class="empty">{m.assist_styles_empty()}</p>{/if}
    {#each rows as row (`${row.site}/${row.id}`)}
      {@const mark = favicons.forPage(`https://${row.site}`)}
      <div class="row">
        <span class="mark"
          ><FavIcon
            image={mark?.image ?? null}
            tone={mark?.tone}
            size={20}
            fallback={Globe02Icon}
          /></span
        >
        <span class="words">
          <strong>{row.site}</strong>
          <span>{row.summary}</span>
        </span>
        <Switch
          label={m.assist_styles_toggle({ site: row.site })}
          labelHidden
          checked={row.enabled}
          disabled={busy}
          onchange={(enabled) =>
            void change(() => commands.pageStyleToggleFor(profile.id, row.site, row.id, enabled))}
        />
        <IconButton
          icon={Cancel01Icon}
          size={14}
          buttonSize={26}
          label={m.assist_styles_remove({ site: row.site })}
          disabled={busy}
          onclick={() =>
            void change(() => commands.pageStyleRemoveFor(profile.id, row.site, row.id))}
        />
      </div>
    {/each}
  </SettingsGroup>
  {#if failed}<p class="note" role="alert">{m.assist_styles_unavailable()}</p>{/if}
{/if}

<style>
  .row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 12px;
    box-sizing: border-box;
    min-block-size: var(--row-page);
    padding: 10px 12px 10px 18px;
  }

  .row + .row::before {
    content: "";
    position: absolute;
    inset-inline: 50px 0;
    inset-block-start: 0;
    block-size: 1px;
    background: var(--color-border);
  }

  .mark {
    display: grid;
    flex: none;
    place-items: center;
    inline-size: 20px;
    block-size: 20px;
  }

  .words {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 1px;
    min-inline-size: 0;
  }

  strong {
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--text-page-title);
    font-weight: 500;
    line-height: 19px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .words > span {
    overflow: hidden;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 0;
    padding: 16px 18px 12px;
    color: var(--color-muted);
    font-size: var(--text-body);
    line-height: 1.5;
  }

  .note {
    margin: -26px 16px 28px;
    color: var(--color-muted);
    font-size: var(--text-label);
    line-height: 1.5;
  }
</style>
