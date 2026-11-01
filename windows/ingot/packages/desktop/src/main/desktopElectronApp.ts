import { app } from "electron";
import { getAppConfigDir } from "@origin-ai/cf-services/node";

export type ElectronAppPathName = "appData" | "userData";

export function isElectronAppPackaged(): boolean {
  return (
    (app as unknown as { isPackaged?: boolean } | undefined)?.isPackaged === true
  );
}

export function getElectronAppPath(name: ElectronAppPathName): string {
  const electronApp = app as unknown as
    | { getPath?: (pathName: ElectronAppPathName) => string }
    | undefined;
  if (electronApp?.getPath) {
    return electronApp.getPath(name);
  }

  return getAppConfigDir();
}
