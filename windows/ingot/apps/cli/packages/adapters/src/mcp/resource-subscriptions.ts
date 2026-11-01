
export class McpResourceSubscriptionRegistry {
  private readonly byServer = new Map<string, Map<string, Set<string>>>();

  
  add(serverName: string, uri: string, subscriberKey: string): { first: boolean } {
    const byUri = this.byServer.get(serverName) ?? new Map<string, Set<string>>();
    this.byServer.set(serverName, byUri);
    const subscribers = byUri.get(uri) ?? new Set<string>();
    const first = subscribers.size === 0;
    subscribers.add(subscriberKey);
    byUri.set(uri, subscribers);
    return { first };
  }

  
  remove(serverName: string, uri: string, subscriberKey: string): { last: boolean } | null {
    const byUri = this.byServer.get(serverName);
    const subscribers = byUri?.get(uri);
    if (!byUri || !subscribers || !subscribers.delete(subscriberKey)) return null;
    if (subscribers.size > 0) return { last: false };
    byUri.delete(uri);
    return { last: true };
  }

  
  removeByPrefix(subscriberKeyPrefix: string): Array<{ serverName: string; uri: string }> {
    const released: Array<{ serverName: string; uri: string }> = [];
    for (const [serverName, byUri] of this.byServer) {
      for (const [uri, subscribers] of byUri) {
        for (const key of [...subscribers]) {
          if (key.startsWith(subscriberKeyPrefix)) subscribers.delete(key);
        }
        if (subscribers.size === 0) {
          byUri.delete(uri);
          released.push({ serverName, uri });
        }
      }
    }
    return released;
  }

  
  subscribers(serverName: string, uri: string): string[] {
    return [...(this.byServer.get(serverName)?.get(uri) ?? [])];
  }

  
  allSubscribers(serverName: string): string[] {
    const out = new Set<string>();
    for (const keys of this.byServer.get(serverName)?.values() ?? []) {
      for (const key of keys) out.add(key);
    }
    return [...out];
  }

  
  uris(serverName: string): string[] {
    return [...(this.byServer.get(serverName)?.keys() ?? [])];
  }

  
  counts(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = {};
    for (const [serverName, byUri] of this.byServer) {
      out[serverName] = Object.fromEntries(
        [...byUri].map(([uri, subscribers]) => [uri, subscribers.size]),
      );
    }
    return out;
  }
}
