<script lang="ts">
  import * as m from "$shared/i18n/messages";
  import SettingsGroup from "$shared/ui/SettingsGroup";
  import FeatureSwitch from "../FeatureSwitch.svelte";
</script>

<SettingsGroup title={m.features_ai_group()}>
  <FeatureSwitch feature="ai" />
  <FeatureSwitch feature="work" />
</SettingsGroup>

<SettingsGroup title={m.features_tools_group()}>
  <FeatureSwitch feature="notes" />
  <FeatureSwitch feature="tasks" />
  <FeatureSwitch feature="time" />
</SettingsGroup>
