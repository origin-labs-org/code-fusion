import type { TaskChatMessage as ChatMessage } from "@/lib/taskChatMessageTypes.js";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import type { IBotsService, ICfAgentService, ICfTaskService } from "@origin-ai/cf-services";
import type { TaskListE2EActions } from "@/lib/taskListE2EActions.js";
import { useEffect } from "react";

declare global {
  interface ImportMeta {
    env: { PROD: boolean; DEV: boolean; [key: string]: unknown };
  }
}

export interface TestActions extends TaskListE2EActions {
  
  sendBotMessage: IBotsService["handleInboundMessage"];
  
  submitBotGroupInput: NonNullable<ICfTaskService["submitBotGroupInput"]>;
  
  getTheme: () => string;
  
  setTheme: (theme: "light" | "dark" | "cf-light" | "cf-dark" | "system") => void;
  
  getLocale: () => "zh-CN" | "en-US";
  
  setLocale: (locale: "zh-CN" | "en-US") => void;
  
  setChatMessages: (messages: ChatMessage[]) => void;
  
  getChatMessageCount: () => number;
  
  getPluginsOverview: ICfAgentService["getPluginsOverview"];
  
  addPluginMarketplace: ICfAgentService["addPluginMarketplace"];
  
  updatePluginMarketplace: ICfAgentService["updatePluginMarketplace"];
  
  installPlugin: ICfAgentService["installPlugin"];
  
  listPlugins: ICfAgentService["listPlugins"];
  
  getPluginReferenceCatalog: ICfAgentService["getPluginReferenceCatalog"];
}

declare global {
  interface Window {
    __testActions?: TestActions;
  }
}

export function useTestActions(actions: TestActions) {
  useEffect(() => {
    if (import.meta.env.PROD && !shouldExposeE2EStoreBridge()) return;
    window.__testActions = actions;
    return () => {
      actions.releaseTaskMembershipRefreshHold();
      delete window.__testActions;
    };
  }, [actions]);
}
