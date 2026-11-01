

import { Emitter, IDisposable, toDisposable } from "./foundation.js";
import { ISocket } from "./protocol.js";
import { PersistentProtocol } from "./persistent-protocol.js";
import { IPCClient } from "./ipc.js";

// ============================================================================
// Remote Authority
// ============================================================================

export enum RemoteConnectionType {
  WebSocket = 0,
  Managed = 1,
}

export class WebSocketRemoteConnection {
  readonly type = RemoteConnectionType.WebSocket;
  constructor(
    public readonly host: string,
    public readonly port: number,
  ) {}

  toString(): string {
    return `WebSocket(${this.host}:${this.port})`;
  }
}

export class ManagedRemoteConnection {
  readonly type = RemoteConnectionType.Managed;
  constructor(public readonly id: number) {}

  toString(): string {
    return `Managed(${this.id})`;
  }
}

export type RemoteConnection = WebSocketRemoteConnection | ManagedRemoteConnection;

export interface ResolvedAuthority {
  readonly authority: string;
  readonly connectTo: RemoteConnection;
  readonly connectionToken: string | undefined;
}

// ============================================================================
// Remote Authority Resolver
// ============================================================================

export interface IRemoteAuthorityResolver {
  resolve(authority: string): Promise<ResolvedAuthority>;
}

export class RemoteAuthorityResolverService {
  private resolvers = new Map<string, IRemoteAuthorityResolver>();

  
  registerResolver(type: string, resolver: IRemoteAuthorityResolver): IDisposable {
    this.resolvers.set(type, resolver);
    return toDisposable(() => this.resolvers.delete(type));
  }

  
  async resolveAuthority(authority: string): Promise<ResolvedAuthority> {
    const plusIndex = authority.indexOf("+");
    const type = plusIndex >= 0 ? authority.substring(0, plusIndex) : authority;

    const resolver = this.resolvers.get(type);
    if (!resolver) {
      throw new Error(`No resolver registered for remote type: ${type}`);
    }

    return resolver.resolve(authority);
  }
}

// ============================================================================
// Remote Socket Factory
// ============================================================================

export interface ISocketFactory<T extends RemoteConnectionType = RemoteConnectionType> {
  supports(connectTo: RemoteConnection & { type: T }): boolean;
  connect(connectTo: RemoteConnection & { type: T }, path: string, query: string): Promise<ISocket>;
}

export class RemoteSocketFactoryService {
  private readonly factories: Map<RemoteConnectionType, ISocketFactory[]> = new Map();

  register<T extends RemoteConnectionType>(type: T, factory: ISocketFactory<T>): IDisposable {
    if (!this.factories.has(type)) {
      this.factories.set(type, []);
    }
    this.factories.get(type)!.push(factory as ISocketFactory);
    return toDisposable(() => {
      const list = this.factories.get(type);
      if (list) {
        const idx = list.indexOf(factory as ISocketFactory);
        if (idx >= 0) {
          list.splice(idx, 1);
        }
      }
    });
  }

  async connect(connectTo: RemoteConnection, path: string, query: string): Promise<ISocket> {
    const factories = this.factories.get(connectTo.type) || [];
    const factory = factories.find((f) => f.supports(connectTo as any));
    if (!factory) {
      throw new Error(`No socket factory found for ${connectTo}`);
    }
    return factory.connect(connectTo as any, path, query);
  }
}

// ============================================================================
// URI Transformer
// ============================================================================

export interface IURITransformer {
  
  transformIncoming(uri: SimpleURI): SimpleURI;
  
  transformOutgoing(uri: SimpleURI): SimpleURI;
}

export interface SimpleURI {
  scheme: string;
  authority: string;
  path: string;
}

export function createURITransformer(remoteAuthority: string): IURITransformer {
  return {
    transformIncoming(uri: SimpleURI): SimpleURI {
      // vscode-remote://authority/path → file:///path
      if (uri.scheme === "vscode-remote" && uri.authority === remoteAuthority) {
        return { scheme: "file", authority: "", path: uri.path };
      }
      // file:///local → vscode-local:///local
      if (uri.scheme === "file") {
        return { scheme: "vscode-local", authority: "", path: uri.path };
      }
      return uri;
    },

    transformOutgoing(uri: SimpleURI): SimpleURI {
      // file:///path → vscode-remote://authority/path
      if (uri.scheme === "file") {
        return { scheme: "vscode-remote", authority: remoteAuthority, path: uri.path };
      }
      // vscode-local:///local → file:///local
      if (uri.scheme === "vscode-local") {
        return { scheme: "file", authority: "", path: uri.path };
      }
      return uri;
    },
  };
}

// ============================================================================
// ============================================================================

const RECONNECT_DELAYS = [0, 5, 5, 10, 10, 10, 10, 10, 30];

export interface RemoteConnectionState {
  type: "connected" | "reconnecting" | "disconnected";
}

export class RemoteAgentConnection implements IDisposable {
  private protocol: PersistentProtocol | null = null;
  private client: IPCClient<string> | null = null;

  private readonly _onDidStateChange = new Emitter<RemoteConnectionState>();
  readonly onDidStateChange = this._onDidStateChange.event;

  constructor(
    private readonly authority: string,
    private readonly resolverService: RemoteAuthorityResolverService,
    private readonly socketFactory: RemoteSocketFactoryService,
  ) {}

  
  async connect(): Promise<IPCClient<string>> {
    const resolved = await this.resolverService.resolveAuthority(this.authority);

    const query = resolved.connectionToken ? `token=${resolved.connectionToken}` : "";
    const socket = await this.socketFactory.connect(resolved.connectTo, "/", query);

    this.protocol = new PersistentProtocol(socket);

    this.client = new IPCClient(this.protocol, this.authority);

    this.protocol.onSocketClose(() => {
      this._onDidStateChange.fire({ type: "reconnecting" });
      this.reconnect(resolved, 0);
    });

    this._onDidStateChange.fire({ type: "connected" });
    return this.client;
  }

  private async reconnect(resolved: ResolvedAuthority, attempt: number): Promise<void> {
    if (attempt >= RECONNECT_DELAYS.length) {
      this._onDidStateChange.fire({ type: "disconnected" });
      return;
    }

    const delay = RECONNECT_DELAYS[attempt] * 1000;
    await new Promise((r) => setTimeout(r, delay));

    try {
      const query = resolved.connectionToken ? `token=${resolved.connectionToken}` : "";
      const newSocket = await this.socketFactory.connect(resolved.connectTo, "/", query);

      this.protocol!.replaceSocket(newSocket);
      this._onDidStateChange.fire({ type: "connected" });
    } catch {
      this.reconnect(resolved, attempt + 1);
    }
  }

  dispose(): void {
    this.client?.dispose();
    this.protocol?.dispose();
    this._onDidStateChange.dispose();
  }
}
