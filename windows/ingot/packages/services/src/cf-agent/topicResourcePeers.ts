import type { IChannel } from "@origin-ai/cf-rpc";
import { cfTopicResourceRelayRequestSchema } from "@origin-ai/cf-shared";
import type { ICfAgentService } from "./cfAgent.js";
import { readTrustedCfAgentV4Connection } from "./cfAgentConnectionScope.js";

interface Peer {
  channel: IChannel;
  routes: Map<string, string>;
  closed: boolean;
}

export function createTopicResourcePeers() {
  const owners = new Map<string, Peer>();
  const key = (identity: string, session: string) => JSON.stringify([identity.trim(), session]);
  return {
    getChannel(value: unknown): IChannel {
      const request = cfTopicResourceRelayRequestSchema.parse(value);
      const peer = owners.get(key(request.workspaceIdentity, request.remoteSessionId));
      if (!peer || peer.closed) throw new Error("Topic resource source peer unavailable");
      return peer.channel;
    },
    attach(channel: IChannel) {
      const peer: Peer = { channel, routes: new Map(), closed: false };
      const bind = (value: unknown) => {
        if (peer.closed) return;
        if (!readTrustedCfAgentV4Connection(value)) return;
        const request = value as Record<string, unknown>;
        if (request.remoteSessionId === undefined) return;
        if (
          typeof request.remoteSessionId !== "string" ||
          !request.remoteSessionId ||
          typeof request.workspaceIdentity !== "string" ||
          !request.workspaceIdentity.trim()
        )
          throw new Error("Topic resource remote identity unavailable");
        const route = key(request.workspaceIdentity, request.remoteSessionId);
        const owner = owners.get(route);
        if (owner && owner !== peer)
          throw new Error("Topic resource route belongs to another peer");
        const previous = peer.routes.get(request.remoteSessionId);
        if (previous && previous !== route && owners.get(previous) === peer)
          owners.delete(previous);
        owners.set(route, peer);
        peer.routes.set(request.remoteSessionId, route);
      };
      return {
        wrapAgent(base: ICfAgentService): ICfAgentService {
          return new Proxy(base, {
            get(target, property) {
              const value = Reflect.get(target, property, target);
              if (typeof value !== "function") return value;
              return (...args: unknown[]) => {
                bind(args[0]);
                return value.apply(target, args);
              };
            },
          });
        },
        dispose() {
          peer.closed = true;
          for (const route of peer.routes.values())
            if (owners.get(route) === peer) owners.delete(route);
          peer.routes.clear();
        },
      };
    },
  };
}
export type TopicResourcePeers = ReturnType<typeof createTopicResourcePeers>;
