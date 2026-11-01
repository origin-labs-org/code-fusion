import { useMemo } from "react";
import type { IProjectService } from "@/project-sidebar/contract.js";

export function useProjectDirectoryServices(service: IProjectService, hostId?: string) {
  return useMemo(
    () => ({
      services: {
        systemService: {
          info: async () => ({ homedir: (await service.readDirectory({ hostId })).path }),
        },
        fileService: {
          readdir: async (params: { path: string; includeHidden?: boolean }) =>
            (await service.readDirectory({ ...params, hostId })).entries,
        },
      },
    }),
    [service, hostId],
  );
}
