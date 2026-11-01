import { createContext, useContext } from "react";
import type { ConversationPanePresentationValue } from "@/side-pane-full-view/contract.js";

const noop = () => {};

const DOCKED_PRESENTATION: ConversationPanePresentationValue = {
  presentation: "docked",
  reportFloatingStatus: noop,
  reportComposerDockHeight: noop,
};

export const ConversationPanePresentationContext =
  createContext<ConversationPanePresentationValue>(DOCKED_PRESENTATION);

export function useConversationPanePresentation(): ConversationPanePresentationValue {
  return useContext(ConversationPanePresentationContext);
}
