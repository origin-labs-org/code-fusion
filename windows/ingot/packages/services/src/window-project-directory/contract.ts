import type { Event } from "@origin-ai/cf-rpc";
import { ServiceChannels } from "@origin-ai/cf-shared";
import { createServiceDescriptor } from "#src/descriptors.js";
import type { IProjectService } from "#src/project/contract.js";
import type { IRemoteProjectService } from "#src/remote-projects/contract.js";

export interface IWindowProjectChangesService {
  getCapabilities(): Promise<{ version: 1 }>;
  onDidChange: Event<void>;
}

export interface WindowProjectDirectoryServices {
  projectService: IProjectService;
  remoteProjectService: IRemoteProjectService;
  changesService: IWindowProjectChangesService;
}

export const IWindowProjectService = createServiceDescriptor<IProjectService>(
  ServiceChannels.WindowProject,
);
export const IWindowRemoteProjectService = createServiceDescriptor<IRemoteProjectService>(
  ServiceChannels.WindowRemoteProjects,
);
export const IWindowProjectChangesService = createServiceDescriptor<IWindowProjectChangesService>(
  ServiceChannels.WindowProjectChanges,
);
