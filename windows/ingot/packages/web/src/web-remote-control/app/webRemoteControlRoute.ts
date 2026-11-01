import { resolveWebRemoteControlRoutePathFromBaseUrl } from "@origin-ai/cf-shared";

interface WebRemoteControlRouteEnv {
  readonly VITE_WEB_REMOTE_CONTROL_ROUTE_PATH?: string;
  readonly BASE_URL: string;
}

export function resolveWebRemoteControlRoutePath(env: WebRemoteControlRouteEnv): string {
  const explicitRoutePath = env.VITE_WEB_REMOTE_CONTROL_ROUTE_PATH?.trim();
  return resolveWebRemoteControlRoutePathFromBaseUrl(explicitRoutePath || env.BASE_URL);
}
