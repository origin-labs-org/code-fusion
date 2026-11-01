// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TID_OAUTH_CANCEL, TID_OAUTH_ERROR, TID_OAUTH_LOGIN_BUTTON } from "@origin-ai/cf-shared/test-ids";

const oauthState = vi.hoisted(() => ({
  status: "idle" as "idle" | "waiting" | "error",
  error: null as string | null,
  providers: [
    { id: "bigmodel", displayName: "BigModel", enabled: true, order: 0 },
    { id: "zai", displayName: "Z.AI", enabled: true, order: 1 },
  ] as Array<{ id: string; displayName: string; enabled: boolean; order: number }>,
}));

const oauthActions = vi.hoisted(() => ({
  startLogin: vi.fn(),
  cancel: vi.fn(),
  reset: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  oauthError: null as string | null,
  setOAuthError: vi.fn(),
  markLoginEntryAttemptStatus: vi.fn(),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({ executeDesktopCommand: vi.fn().mockResolvedValue(undefined) }),
}));

vi.mock("@/hooks/useOAuth.js", () => ({
  useOAuth: () => ({
    startLogin: oauthActions.startLogin,
    cancel: oauthActions.cancel,
    reset: oauthActions.reset,
    status: oauthState.status,
    error: oauthState.error,
    providers: oauthState.providers,
    activeProvider: null,
    loadingProviders: false,
    pendingProvider: null,
    refreshProviders: vi.fn(),
  }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

vi.mock("@/store/StoreProvider.js", () => ({
  useCfStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: null,
      oauthError: storeState.oauthError,
      setOAuthError: storeState.setOAuthError,
      oauthSuccessSeq: 0,
      lastOAuthSuccessProvider: null,
      loginEntryRequest: null,
      loginEntryAttempt: null,
      clearLoginEntryRequest: vi.fn(),
      markLoginEntryAttemptStatus: storeState.markLoginEntryAttemptStatus,
    }),
}));

async function renderWelcomeScreen() {
  const { WelcomeScreen } = await import("@/WelcomeScreen.js");
  const view = render(createElement(WelcomeScreen, { onComplete: vi.fn() }));
  return { view, WelcomeScreen };
}

describe("Cancel interaction in login failed state", () => {
  beforeEach(() => {
    oauthState.status = "error";
    oauthState.error = "登录失败，请重试";
    storeState.oauthError = null;
    oauthActions.startLogin.mockClear();
    oauthActions.cancel.mockClear();
    oauthActions.reset.mockClear();
    storeState.setOAuthError.mockClear();
    storeState.markLoginEntryAttemptStatus.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("Show cancel button and hide channel list on local startup failure", async () => {
    await renderWelcomeScreen();

    expect(screen.getByTestId(TID_OAUTH_ERROR)).toBeTruthy();
    expect(screen.getByTestId(TID_OAUTH_CANCEL)).toBeTruthy();

    expect(screen.queryByTestId(TID_OAUTH_LOGIN_BUTTON)).toBeNull();
  });

  it("Failed state triggered by Root-level oauthError also replaces channel list, no longer sharing screen with button list", async () => {
    oauthState.status = "idle";
    oauthState.error = null;
    storeState.oauthError = "登录失败，请重试";

    await renderWelcomeScreen();

    expect(screen.getByTestId(TID_OAUTH_ERROR)).toBeTruthy();
    expect(screen.getByTestId(TID_OAUTH_CANCEL)).toBeTruthy();
    expect(screen.queryByTestId(TID_OAUTH_LOGIN_BUTTON)).toBeNull();
  });

  it("Click cancel in failed state: clear store error, cancel pending, and restore channel list once idle", async () => {
    const { view, WelcomeScreen } = await renderWelcomeScreen();

    fireEvent.click(screen.getByTestId(TID_OAUTH_CANCEL));

    expect(oauthActions.cancel).toHaveBeenCalledTimes(1);
    expect(storeState.setOAuthError).toHaveBeenCalledWith(null);

    oauthState.status = "idle";
    oauthState.error = null;
    storeState.oauthError = null;
    view.rerender(createElement(WelcomeScreen, { onComplete: vi.fn() }));

    expect(screen.getByTestId(TID_OAUTH_LOGIN_BUTTON)).toBeTruthy();
    expect(screen.queryByTestId(TID_OAUTH_ERROR)).toBeNull();
    expect(screen.queryByTestId(TID_OAUTH_CANCEL)).toBeNull();
  });

  it("Click retry login after failure: clear store error and retry with the recently failed channel", async () => {
    await renderWelcomeScreen();

    fireEvent.click(screen.getByText("login.oauth.retry"));

    expect(storeState.setOAuthError).toHaveBeenCalledWith(null);
    expect(oauthActions.startLogin).toHaveBeenCalledWith(
      expect.stringMatching(/^(bigmodel|zai)$/u),
      undefined,
    );
  });

  it("Waiting state cancel button coexists with failed state cancel without conflict: waiting state only has cancel, no error prompt", async () => {
    oauthState.status = "waiting";
    oauthState.error = null;

    await renderWelcomeScreen();

    expect(screen.getByTestId(TID_OAUTH_CANCEL)).toBeTruthy();
    expect(screen.queryByTestId(TID_OAUTH_ERROR)).toBeNull();
    expect(screen.queryByTestId(TID_OAUTH_LOGIN_BUTTON)).toBeNull();
  });
});
