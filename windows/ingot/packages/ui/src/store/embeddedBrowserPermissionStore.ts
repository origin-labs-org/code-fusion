import { create } from "zustand";
import type { EmbeddedBrowserPermissionPromptEvent } from "@origin-ai/cf-shared";

interface EmbeddedBrowserPermissionState {
  prompts: EmbeddedBrowserPermissionPromptEvent[];
  receivePrompt: (event: EmbeddedBrowserPermissionPromptEvent) => void;
  
  dropPrompt: (requestId: string) => void;
}

export const useEmbeddedBrowserPermissionStore = create<EmbeddedBrowserPermissionState>((set) => ({
  prompts: [],
  receivePrompt: (event) =>
    set((state) => ({
      prompts: state.prompts.some((prompt) => prompt.requestId === event.requestId)
        ? state.prompts.map((prompt) => (prompt.requestId === event.requestId ? event : prompt))
        : [...state.prompts, event],
    })),
  dropPrompt: (requestId) =>
    set((state) => ({ prompts: state.prompts.filter((prompt) => prompt.requestId !== requestId) })),
}));
