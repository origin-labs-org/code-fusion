
import type {
  SidePaneFullViewController,
  SidePaneFullViewHostMode,
} from "@/side-pane-full-view/contract.js";

export function exampleSidePaneFullView(controller: SidePaneFullViewController): {
  mode: SidePaneFullViewHostMode;
  sidebarVisible: (isSidebarVisible: boolean) => boolean;
} {
  controller.setSurface("side-pane");
  const fullView = controller.fullView;
  return {
    mode: !fullView ? "normal" : fullView.surface === "conversation" ? "conversation" : "floating",
    sidebarVisible: (isSidebarVisible) => isSidebarVisible && fullView === null,
  };
}
