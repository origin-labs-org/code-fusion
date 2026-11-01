export interface ArmsUserIdentitySyncDeps {
  
  deviceMid: string;
  
  setUser: (user: { name: string }) => void;
}

export interface ArmsUserIdentitySync {
  
  refresh: () => void;
}

export function createArmsUserIdentitySync(
  deps: ArmsUserIdentitySyncDeps,
): ArmsUserIdentitySync {
  let lastWrittenName: string | null = null;

  function refresh(): void {
    if (deps.deviceMid === lastWrittenName) {
      return;
    }
    lastWrittenName = deps.deviceMid;
    deps.setUser({ name: deps.deviceMid });
  }

  return { refresh };
}
