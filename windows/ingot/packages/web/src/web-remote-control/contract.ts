import type { WebRemoteControlFailure, WebRemoteControlV2QrParams } from "@origin-ai/cf-shared";
import type { WebRemoteControlRelayV2Device } from "@origin-ai/cf-shared/web-remote-relay";
import type { WebOAuthProviderId } from "#src/auth/browserOAuthCredentialRepo.js";
import type { WebAuthService } from "#src/auth/webAuthService.js";

export interface WebRemoteControlDeviceGroup {
  deviceMid: string;
  name?: string;
  
  platform?: string;
  onlineConnections: WebRemoteControlRelayV2Device[];
}

export interface KnownDevice {
  name?: string;
  platform?: string;
}

export interface WebRemoteControlDeviceListAccount {
  displayName: string;
  avatarUrl?: string;
  provider: WebOAuthProviderId;
}

export type WebRemoteControlDeviceListView = {
  kind: "devices";
  devices: WebRemoteControlDeviceGroup[];
  loading: boolean;
  error: boolean;
  account?: WebRemoteControlDeviceListAccount;
};

export type WebRemoteControlEntryView =
  | { kind: "callback" | "login" }
  | WebRemoteControlDeviceListView
  | { kind: "failure"; failure: WebRemoteControlFailure };

export interface WebRemoteControlEntryConnection {
  params: WebRemoteControlV2QrParams & { deviceSid: string };
  signal: AbortSignal;
  getToken(signal: AbortSignal): Promise<string>;
  onPaired(): void;
  onFailure(failure: WebRemoteControlFailure): void;
}

export interface WebRemoteControlEntryOptions {
  auth: Pick<WebAuthService, "getCfJwtToken" | "getActiveAccount" | "startLogin" | "logout">;
  getHref(): string;
  replaceHref(href: string): void;
  storage: Pick<Storage, "getItem" | "setItem">;
  locale: "zh-CN" | "en-US";
  devices(jwt: string, signal: AbortSignal): Promise<WebRemoteControlRelayV2Device[]>;
  subscribeVisible(listener: () => void): () => void;
  loginOptions?: Parameters<WebAuthService["startLogin"]>[0];
  token(jwt: string, signal: AbortSignal): Promise<string>;
  connect(connection: WebRemoteControlEntryConnection): void;
  onView(view: WebRemoteControlEntryView): void;
}

export type * from "#src/web-remote-control/contracts/transport.js";
