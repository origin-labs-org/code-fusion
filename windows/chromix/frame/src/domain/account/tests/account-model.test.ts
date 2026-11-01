import { describe, expect, it } from "vitest";
import {
  avatarUrl,
  creditsCall,
  creditsLeft,
  creditsToUnits,
  creditsTotal,
  initials,
  offerKey,
  planName,
  positive,
  priceLabel,
  requestStanding,
  shortDate,
  stagedAvatarUrl,
  sumUnits,
  unitsToCredits,
  usageTone,
} from "../account-model";

describe("account model", () => {
  it("names the account picture only by the revision Rust holds, never a server address", () => {
    expect(avatarUrl(3)).toMatch(
      /^(zephium-media:\/\/localhost|http:\/\/zephium-media\.localhost)\/account-avatar\/3$/u,
    );
    for (const none of [null, undefined, 0, -1, 1.5]) expect(avatarUrl(none)).toBeNull();
    expect(stagedAvatarUrl("01JABCDEFGHJKMNPQRSTVWXYZ0")).toMatch(
      /account-avatar\/staged\/01JABCDEFGHJKMNPQRSTVWXYZ0$/u,
    );
    expect(stagedAvatarUrl("../../v1/account")).toBeNull();
  });

  it("draws initials from a name, else from the address", () => {
    expect(initials("ada@example.com", "Ada Lovelace")).toBe("AL");
    expect(initials("ada@example.com", "  ada ")).toBe("A");
    expect(initials("_42x@example.com")).toBe("4");
    expect(initials("@example.com")).toBe("");
    expect(initials(null)).toBe("");
  });

  it("names plans the way people read them", () => {
    expect(planName("pro")).toBe("Pro");
    expect(planName("team_plus")).toBe("Team Plus");
    expect(planName(" ")).toBeNull();
    expect(planName(null)).toBeNull();
  });

  it("shows only prices it can state exactly", () => {
    expect(priceLabel({ amount_minor: 2000, currency: "usd" }, "en-US")).toBe("$20");
    expect(priceLabel({ amount_minor: 1999, currency: "EUR" }, "en-US")).toBe("€19.99");
    expect(priceLabel({ amount_minor: 500, currency: "JPY" }, "en-US")).toBe("¥500");
    expect(priceLabel({ amount_minor: 100, currency: "dollars" }, "en-US")).toBeNull();
    expect(priceLabel(null)).toBeNull();
  });

  it("states the renewal day, with the year only when it differs", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    expect(shortDate("2026-10-14T00:00:00Z", now, "en-US")).toMatch(/Oct 1[34]/u);
    expect(shortDate("2027-01-01T12:00:00Z", now, "en-US")).toContain("2027");
    expect(shortDate("not a date", now)).toBeNull();
    expect(shortDate(null, now)).toBeNull();
  });

  it("tones the meter as the allowance runs low", () => {
    expect(usageTone(null)).toBe("calm");
    expect(usageTone(79)).toBe("calm");
    expect(usageTone(80)).toBe("high");
    expect(usageTone(100)).toBe("full");
  });

  it("keys offers by what they buy", () => {
    expect(
      offerKey({
        kind: "plan",
        plan: "pro",
        interval: "yearly",
        name: null,
        price: null,
        features: [],
      }),
    ).toBe("plan:pro:yearly");
    expect(
      offerKey({
        kind: "top_up",
        id: "s",
        name: null,
        units: null,
        price: null,
        expires_days: null,
      }),
    ).toBe("topup:s");
  });

  it("states balances in whole credits from the server's factor, rounded down", () => {
    // Staging: 10,000 units to a credit, 100 credits to a dollar.
    expect(creditsLeft("1880000", "10000", "en-US")).toBe("188");
    expect(creditsLeft("1889999", "10000", "en-US")).toBe("188");
    expect(creditsLeft("123456789", "10000", "en-US")).toBe("12,345");
    expect(creditsLeft("0", "10000", "en-US")).toBe("0");
    expect(creditsLeft("9999", "10000", "en-US")).toBe("0");
    // No factor, no credit: percentages are all there is to show.
    expect(creditsLeft("1880000", null)).toBeNull();
    expect(creditsLeft("1880000", undefined)).toBeNull();
    for (const bad of ["0", "-5", "1.5", "", "abc", "10000000000000"]) {
      expect(creditsLeft("1880000", bad), bad).toBeNull();
    }
    expect(creditsLeft("-1", "10000")).toBeNull();
    expect(creditsLeft("1.5", "10000")).toBeNull();
    expect(creditsLeft(null, "10000")).toBeNull();
    // The factor is read, never assumed: another server counts differently.
    expect(creditsLeft("1880000", "1000", "en-US")).toBe("1,880");
  });

  it("states task totals in whole credits, never zero for something spent", () => {
    expect(creditsTotal("1280000", "10000", "en-US")).toBe("128");
    expect(creditsTotal("812000", "10000", "en-US")).toBe("81");
    expect(creditsTotal("815000", "10000", "en-US")).toBe("82");
    expect(creditsTotal("3000", "10000", "en-US")).toBe("<1");
    expect(creditsTotal("0", "10000", "en-US")).toBe("0");
    expect(creditsTotal("12", null)).toBeNull();
  });

  it("states one call to a tenth of a credit", () => {
    expect(creditsCall("3000", "10000", "en-US")).toBe("0.3");
    expect(creditsCall("1200", "10000", "en-US")).toBe("0.12");
    expect(creditsCall("812000", "10000", "en-US")).toBe("81.2");
    expect(creditsCall("20000", "10000", "en-US")).toBe("2");
    expect(creditsCall("400", "10000", "en-US")).toBe("0.04");
    expect(creditsCall("10", "10000", "en-US")).toBe("<0.01");
    expect(creditsCall("0", "10000", "en-US")).toBe("0");
    expect(creditsCall("3000", null)).toBeNull();
  });

  it("adds units exactly and converts a typed limit both ways", () => {
    expect(sumUnits(["812000", null, "400000", "abc", "-4"])).toBe("1212000");
    expect(sumUnits(["123456789012345678901234", "1"])).toBe("123456789012345678901235");
    expect(creditsToUnits(" 40 ", "10000")).toBe("400000");
    expect(creditsToUnits("4.5", "10000")).toBeNull();
    expect(creditsToUnits("", "10000")).toBeNull();
    expect(creditsToUnits("40", null)).toBeNull();
    expect(unitsToCredits("400000", "10000")).toBe("40");
    expect(unitsToCredits("400000", null)).toBeNull();
    expect(positive("0")).toBe(false);
    expect(positive("1")).toBe(true);
    expect(positive(null)).toBe(false);
  });

  it("treats only a settled request as charged", () => {
    expect(requestStanding("settled")).toBe("charged");
    expect(requestStanding("released")).toBe("free");
    expect(requestStanding("usage_unknown")).toBe("checking");
    expect(requestStanding("reserved")).toBe("running");
    expect(requestStanding("running")).toBe("running");
  });
});
