import type { OAuthCachedSessionRestoreResult, UserInfo } from "@origin-ai/cf-shared";
import type { AlertDialogRequest } from "@/store/alertDialogStore.js";

export async function requestOAuthReauthentication(params: {
  setUser: (user: UserInfo | null) => void;
  requestAlert: (request: AlertDialogRequest) => Promise<boolean>;
  onReauthenticationRequired: () => void;
  copy: AlertDialogRequest;
  shouldReauthenticate?: () => Promise<boolean>;
}): Promise<void> {
  if (params.shouldReauthenticate && !(await params.shouldReauthenticate())) return;
  params.setUser(null);
  await params.requestAlert(params.copy);
  if (params.shouldReauthenticate && !(await params.shouldReauthenticate())) return;
  params.onReauthenticationRequired();
}

export async function applyCachedOAuthSessionRestoreResult(params: {
  result: OAuthCachedSessionRestoreResult;
  setUser: (user: UserInfo | null) => void;
  requestAlert: (request: AlertDialogRequest) => Promise<boolean>;
  onReauthenticationRequired: () => void;
  copy: AlertDialogRequest;
  shouldReauthenticate?: () => Promise<boolean>;
}): Promise<boolean> {
  if (params.result.status === "authenticated") {
    params.setUser(params.result.userInfo);
    return true;
  }

  if (params.result.status === "reauthentication-required") {
    await requestOAuthReauthentication(params);
  }

  return false;
}
