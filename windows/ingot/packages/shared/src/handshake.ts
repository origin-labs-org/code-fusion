export interface HelloMessage {
  type: "cf-hello";
  version: string;
  platform: string;
  arch: string;
  pid: number;
}

export interface HelloAckMessage {
  type: "cf-hello-ack";
  version: string;
  clientId: string;
}
