import type { AppSettings } from "@origin-ai/cf-shared";
import type { ISettingService } from "./setting.js";

export interface SettingServiceUpdatedEvent {
  readonly keys: readonly (keyof AppSettings)[];
}

export interface ObservableSettingService extends ISettingService {
  onDidUpdate(listener: (event: SettingServiceUpdatedEvent) => void): () => void;
}

export function createObservableSettingService(base: ISettingService): ObservableSettingService {
  const listeners = new Set<(event: SettingServiceUpdatedEvent) => void>();
  return {
    ...base,
    onDidUpdate(listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async update(patch, expectedAccountSettings): Promise<void> {
      if (expectedAccountSettings) await base.update(patch, expectedAccountSettings);
      else await base.update(patch);
      const keys = Object.freeze(Object.keys(patch) as (keyof AppSettings)[]);
      if (keys.length === 0) return;
      const event = Object.freeze({ keys });
      for (const listener of listeners) listener(event);
    },
  };
}
