import type { Event } from "@origin-ai/cf-rpc";
import type { FileWatchEvent } from "@origin-ai/cf-shared";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IFileWatcherService {
  
  watch(params: { path: string; recursive?: boolean }): Promise<{ id: string }>;
  
  unwatch(params: { id: string }): Promise<void>;
  
  disposeAll(): void;
  
  onDynamicChange(id: string): Event<FileWatchEvent>;
}

export const IFileWatcherService = createServiceDescriptor<IFileWatcherService>(
  ServiceChannels.FileWatcher,
);
