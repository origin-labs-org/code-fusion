<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import { preferences } from "$domain/preferences";
  import { interfaceLanguages, systemLocale } from "$shared/lib/locale.svelte";
  import { getLocale } from "$shared/i18n/runtime";
  import SettingsRow from "$shared/ui/SettingsRow";
  import Select from "$shared/ui/Select";

  function name(code: string, inLocale: string) {
    try {
      const text = new Intl.DisplayNames([inLocale], { type: "language" }).of(code) ?? code;
      return text.charAt(0).toLocaleUpperCase(inLocale) + text.slice(1);
    } catch {
      return code;
    }
  }

  // Each language in its own words, so it can be found by someone who
  // can't read the one showing.
  let options = $derived([
    {
      value: "system",
      label: `${m.language_system()} (${name(systemLocale(), getLocale() as string)})`,
    },
    ...interfaceLanguages()
      .map((code) => ({ value: code, label: name(code, code) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]);
</script>

<SettingsRow
  settingId="languages.interface"
  title={m.language_interface_title()}
  description={m.language_websites_note()}
>
  <Select
    label={m.language_interface_title()}
    labelHidden
    value={preferences.value("ui.language") || "system"}
    disabled={preferences.saving()}
    {options}
    onchange={(value) => void preferences.set("ui.language", value)}
  />
</SettingsRow>
