import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { installRewardsPageBridge, createRewardsInjectionScript } from "@origin-ai/cf-shared";

it("bridge retains current snapshot, notifications, and unsubscriptions; credentials do not appear in events", () => {
  const window = new EventTarget() as EventTarget & { cfBridge: any };
  const values = new Map<string, string>([["oauth:bigmodel:access_token", "old-account"]]);
  const context = {
    window,
    CustomEvent,
    localStorage: {
      setItem: (k: string, v: string) => values.set(k, v),
      removeItem: (k: string) => values.delete(k),
    },
  };
  runInNewContext(`(${installRewardsPageBridge.toString()})()`, context);
  expect(values.size).toBe(0);
  const bridge = window.cfBridge;
  expect(bridge.getTheme()).toBeNull();
  const themes: string[] = [];
  const off = bridge.onThemeChange((value: string) => themes.push(value));
  const snapshot = {
    theme: "cf-light" as const,
    locale: "en-US" as const,
    auth: { status: "ready" as const, provider: "zai" as const, revision: 1 },
  };
  window.dispatchEvent(new CustomEvent("cf-referrals-context", { detail: snapshot }));
  expect(bridge.getTheme()).toBeNull();
  expect(bridge.getAuthState()).toBeNull();
  runInNewContext(
    createRewardsInjectionScript(snapshot, { oauth: "fixture-token", jwt: "fixture-jwt" }),
    context,
  );
  expect(themes).toEqual(["cf-light"]);
  expect(bridge.getAuthState()).toEqual(snapshot.auth);
  expect(values.get("oauth:zai:access_token")).toBe("fixture-token");
  off();
  runInNewContext(
    createRewardsInjectionScript(
      {
        ...snapshot,
        theme: "cf-dark",
        auth: { status: "anonymous", provider: null, revision: 2 },
      },
      {},
    ),
    context,
  );
  expect(themes).toEqual(["cf-light"]);
  expect(bridge.getTheme()).toBe("cf-dark");
  expect(values.size).toBe(0);
  expect(bridge.notifyPurchaseComplete).toBeUndefined();
});
