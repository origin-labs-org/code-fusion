import { memo, useMemo } from "react";
import type { PluginUiScopeRef } from "@origin-ai/cf-shared/mcp-apps";
import { readPluginUiScopeRef, type PluginUiSidePaneTab } from "@/plugin-ui/contract.js";
import {
  PluginUiConversationScope,
  usePluginUiSidePaneModel,
} from "@/plugin-ui/adapters/usePluginUiSidePaneModel.js";
import { PluginUiSidePaneView } from "@/plugin-ui/components/PluginUiSidePane.js";

type Props = {
  tab: PluginUiSidePaneTab;
  visible: boolean;
  onOpenBrowserUrl?: (url: string) => void;
  
  onCloseTab?: (tabId: string) => void;
};
function Content(props: Props & { scopeRef: PluginUiScopeRef }) {
  return <PluginUiSidePaneView {...usePluginUiSidePaneModel(props)} />;
}

export const PluginUiSidePane = memo(function PluginUiSidePane(props: Props) {
  const scopeRef = useMemo(
    () => readPluginUiScopeRef(props.tab),
    [props.tab.surfaceId, props.tab.toolCallId, props.tab.instanceId],
  );
  if (!scopeRef) return null;
  return (
    <PluginUiConversationScope tab={props.tab}>
      <Content {...props} scopeRef={scopeRef} />
    </PluginUiConversationScope>
  );
});
