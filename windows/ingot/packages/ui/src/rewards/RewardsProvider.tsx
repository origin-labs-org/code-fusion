import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { buildRewardsUrl, resolveRewardsOrigin, CF_ENV } from "@origin-ai/cf-shared";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { useCfStore } from "@/store/StoreProvider.js";
import { resolveTheme } from "@/useTheme.js";
import { RewardsWebview } from "@/rewards/RewardsWebview.js";
import { logger } from "@/logger.js";

const RewardsContext = createContext<(() => Promise<void>) | null>(null);
export const useOpenRewards = () => useContext(RewardsContext);
export function RewardsProvider({
  children,
  desktop,
}: {
  children: ReactNode;
  desktop: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const platform = usePlatform();
  const { locale } = useCfIntl();
  const theme = useCfStore((s) => s.theme);
  const user = useCfStore((s) => s.user);
  const loginAttempt = useCfStore((s) => s.loginEntryAttempt);
  const requestLogin = useCfStore((s) => s.requestLoginEntry);
  const pendingLogin = useRef<number | null>(null);
  const openPage = useCallback(async () => {
    if (desktop) setOpened(true);
    else
      await platform.openExternal(
        buildRewardsUrl(
          resolveRewardsOrigin({ env: CF_ENV }),
          locale,
          resolveTheme(theme) === "dark" ? "cf-dark" : "cf-light",
        ),
      );
  }, [desktop, platform, locale, theme]);
  const open = useCallback(async () => {
    if (!user) {
      if (pendingLogin.current === null)
        pendingLogin.current = requestLogin(undefined, "app-login");
      return;
    }
    pendingLogin.current = null;
    await openPage();
  }, [user, requestLogin, openPage]);
  useEffect(() => {
    const pending = pendingLogin.current;
    if (pending === null || !loginAttempt) return;
    if (
      loginAttempt.id !== pending ||
      loginAttempt.status === "cancelled" ||
      loginAttempt.status === "failed"
    ) {
      pendingLogin.current = null;
      return;
    }
    if (loginAttempt.status === "succeeded" && user) {
      pendingLogin.current = null;
      void openPage().catch((error) => logger.warn("[rewards] Failed to open after sign-in", { error }));
    }
  }, [loginAttempt, user, openPage]);
  return (
    <RewardsContext.Provider value={open}>
      {children}
      {opened && <RewardsWebview onClose={() => setOpened(false)} />}
    </RewardsContext.Provider>
  );
}
