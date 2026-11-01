<script lang="ts">
  import { theme } from "$domain/appearance";
  import { preferences } from "$domain/preferences";
  import AppearancePage from "../components/sections/AppearancePage.svelte";

  // As BrowserApp does: the stored look drives the root.
  $effect(() => {
    theme.applyUiPreferences(preferences.value("ui.accent"), false);
    theme.applyCustomization({
      theme: preferences.value("ui.theme"),
      custom: preferences.value("ui.theme-custom"),
      level: preferences.value("ui.theme-contrast"),
      contrast: preferences.value("ui.contrast") === "true",
      font: preferences.value("ui.font"),
      fontSize: preferences.value("ui.font-size"),
      codeFont: preferences.value("ui.code-font"),
    });
  });
</script>

<!-- The Settings shell's own page frame around the section, as Settings.svelte draws it. -->
<section class="settings-shell" style="height: 100vh">
  <div class="settings-content scrolls">
    <div class="settings-page">
      <div class="settings-view">
        <header class="settings-page-heading">
          <h1>Appearance</h1>
          <p>Themes, color and type, and what the window is made of.</p>
        </header>
        <AppearancePage />
      </div>
    </div>
  </div>
</section>
