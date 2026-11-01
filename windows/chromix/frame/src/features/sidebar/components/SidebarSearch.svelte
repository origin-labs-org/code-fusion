<script lang="ts">
  import { surface } from "$domain/surface";
  import { tabs } from "$domain/tabs";
  import * as m from "$shared/i18n/messages";
  import { commands } from "$shared/ipc/bindings";
  import IconButton from "$shared/ui/IconButton";
  import { Search01Icon } from "@hugeicons/core-free-icons";

  let { small = false }: { small?: boolean } = $props();

  function editAddress() {
    const tab = surface.currentPage() === "work" ? null : tabs.activeTab();
    if (tab?.url && (tab.content ?? "web") === "web") void commands.launcherEdit(tab.id, tab.url);
    else void commands.runCommand("launcher.toggle");
  }
</script>

<IconButton
  icon={Search01Icon}
  label={m.ui_search_or_enter_an_address()}
  size={small ? 15 : 16}
  buttonSize={small ? 26 : 28}
  onclick={editAddress}
/>
