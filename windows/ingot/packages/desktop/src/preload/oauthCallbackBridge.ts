type OAuthCallback = (url: string) => void | Promise<void>;

export function createOAuthCallbackHandler(callback: OAuthCallback, notifyHandled: () => void) {
  return async (_event: unknown, url: string): Promise<void> => {
    try {
      await callback(url);
    } catch {
    } finally {
      notifyHandled();
    }
  };
}
