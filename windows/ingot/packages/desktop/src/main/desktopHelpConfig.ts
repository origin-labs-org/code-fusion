import { net } from "electron";
import {
  buildHelpAppConfigUrl,
  buildCfSourceHeadersFromContext,
  createHelpAppConfigReader,
  CF_ENV,
} from "@origin-ai/cf-shared";

export function createDesktopHelpConfigReader(options: {
  resolveEndpointOrigin: () => Promise<string>;
  appVersion: string;
  deviceMid: string;
  
  getClientLanguage: () => string;
}) {
  const read = createHelpAppConfigReader({
    fetchImpl: (input, init) => net.fetch(input instanceof URL ? input.href : input, init),
  });
  return async () => {
    const endpointOrigin = await options.resolveEndpointOrigin();
    return read(
      buildHelpAppConfigUrl(
        endpointOrigin,
        options.appVersion,
        `${process.platform}-${process.arch}`,
      ),
      buildCfSourceHeadersFromContext({
        endpointOrigin,
        appVersion: options.appVersion,
        clientLanguage: options.getClientLanguage(),
        deviceMid: options.deviceMid,
        platform: process.platform,
        arch: process.arch,
        releaseChannel: CF_ENV,
        sourceTitle: "electron",
      }),
    );
  };
}
