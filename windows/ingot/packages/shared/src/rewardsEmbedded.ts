import { z } from "zod";

export const REWARDS_PARTITION = "persist:cf-rewards";
export const REWARDS_CONTEXT_EVENT = "cf-rewards-context";
export const rewardsContextSchema = z.object({
  theme: z.enum(["cf-light", "cf-dark"]),
  locale: z.enum(["zh-CN", "en-US"]),
  auth: z.object({
    status: z.enum(["ready", "anonymous"]),
    provider: z.enum(["zai", "bigmodel"]).nullable(),
    revision: z.number().int().nonnegative(),
  }),
});
export type RewardsContext = z.infer<typeof rewardsContextSchema>;

export function isTrustedRewardsUrl(
  value: string,
  options: { dev?: boolean; e2e?: boolean } = {},
): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password) return false;
    const trusted =
      ["https://cf.z.ai", "https://cf.z.ai"].includes(url.origin) ||
      (options.dev === true && url.origin === "http://localhost:3000") ||
      (options.e2e === true &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname));
    return (
      trusted &&
      /^\/(cn|en)\/rewards\/?$/.test(url.pathname) &&
      url.searchParams.get("embedded") === "app"
    );
  } catch {
    return false;
  }
}

export function resolveRewardsOrigin(options: {
  env: "test" | "production";
  dev?: boolean;
  override?: string;
  e2e?: boolean;
}): string {
  try {
    if (
      options.override &&
      isTrustedRewardsUrl(buildRewardsUrl(options.override, "en-US", "cf-dark"), options)
    )
      return new URL(options.override).origin;
  } catch {
  }
  return options.env === "test" ? "https://cf.z.ai" : "https://cf.z.ai";
}

export function buildRewardsUrl(
  origin: string,
  locale: string,
  theme: RewardsContext["theme"],
): string {
  // The rewards site still expects its legacy theme identifiers; map the
  // product theme names onto them at the URL boundary.
  const rewardsSiteTheme: Record<RewardsContext["theme"], string> = {
    "cf-light": "zai-light",
    "cf-dark": "zai-dark",
  };
  const url = new URL(`/${locale === "zh-CN" ? "cn" : "en"}/rewards`, origin);
  url.searchParams.set("embedded", "app");
  url.searchParams.set("theme", rewardsSiteTheme[theme]);
  return url.toString();
}
