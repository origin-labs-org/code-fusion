<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { tabs } from "$domain/tabs";
  import { preferences } from "$domain/preferences";
  import SettingsGroup from "$shared/ui/SettingsGroup";
  import SettingsRow from "$shared/ui/SettingsRow";
  import Switch from "$shared/ui/Switch";
  import FeatureSwitch from "../FeatureSwitch.svelte";
  import WorkWebsiteData from "../WorkWebsiteData.svelte";
  import WorkScreenshotSites from "../WorkScreenshotSites.svelte";
  import * as settings from "../../lib/settings-state.svelte";
  let profile = $derived(tabs.profile());
  let regular = $derived(!!profile && profile.kind !== "incognito");
</script>

<FeatureSwitch feature="work" card />
{#if preferences.enabled("work") && preferences.aiEnabled()}
  <SettingsGroup title={m.settings_work_privacy()}>
    <SettingsRow
      settingId="work.screenshots"
      title={m.settings_work_screenshots()}
      description={m.settings_work_screenshots_desc()}
      ><Switch
        label={m.settings_work_screenshots()}
        labelHidden
        checked={preferences.value("work.screenshots") !== "false"}
        disabled={preferences.saving()}
        onchange={(on) => void preferences.set("work.screenshots", String(on))}
      /></SettingsRow
    >
    {#if profile && regular}
      <WorkScreenshotSites profile={profile.id} />
      <WorkWebsiteData profile={profile.id} />
    {/if}
  </SettingsGroup>
  {#if !regular}<p class="work-note">{m.work_regular_profile()}</p>{/if}
{/if}
{#if preferences.enabled("work") && !preferences.aiEnabled()}<p class="work-note">
    {m.work_ai_off_note()}
    <button type="button" class="link" onclick={() => settings.select("features")}
      >{m.work_ai_off_action()}</button
    >
  </p>{/if}

<style>
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text);
    font: inherit;
    font-weight: 500;
    text-decoration: underline;
    text-decoration-color: var(--color-faint);
    text-underline-offset: 2px;
    cursor: default;
  }

  .work-note {
    margin: 0 16px;
    font-size: var(--text-label);
    line-height: 1.5;
    color: var(--color-muted);
  }
</style>
