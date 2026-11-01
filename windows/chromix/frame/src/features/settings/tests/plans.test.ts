import { expect, test } from "vitest";
import { canChangePlan, planCards, yearlySavesTwoMonths, type PlanOffer } from "../lib/plans";

const offer = (
  plan: string,
  interval: string,
  amount: number,
  features: string[] = [],
): PlanOffer => ({
  kind: "plan",
  plan,
  interval,
  name: null,
  price: { amount_minor: amount, currency: "USD" },
  features,
});

const sold = [
  offer("pro", "monthly", 2000),
  offer("pro", "yearly", 20000),
  offer("max", "monthly", 10000),
  offer("max", "yearly", 100000),
];

test("yearly is two months free only when every plan sold both ways costs ten months", () => {
  expect(yearlySavesTwoMonths(sold)).toBe(true);
  expect(yearlySavesTwoMonths([offer("pro", "monthly", 2000), offer("pro", "yearly", 21000)])).toBe(
    false,
  );
  expect(yearlySavesTwoMonths([offer("pro", "monthly", 2000)])).toBe(false);
  expect(
    yearlySavesTwoMonths([...sold, offer("team", "monthly", 500), offer("team", "yearly", 5000)]),
  ).toBe(true);
  expect(yearlySavesTwoMonths([...sold.slice(0, 3), offer("max", "yearly", 90000)])).toBe(false);
});

test("Free is the baseline card, and an unpaid account is offered an upgrade to each plan", () => {
  const cards = planCards({
    plans: sold,
    currentPlan: "free",
    paid: false,
    interval: "yearly",
    review: false,
  });
  expect(cards.map((card) => [card.id, card.action])).toEqual([
    ["free", "current"],
    ["pro", "upgrade"],
    ["max", "upgrade"],
  ]);
  expect(cards[0]!.features.length).toBeGreaterThan(0);
  expect(cards[1]!.price).toBe("$200");
});

test("a subscriber switches, a cheaper plan is a downgrade, and review lets only downgrades through", () => {
  const base = { plans: sold, currentPlan: "max", paid: true, interval: "monthly" };
  const cards = planCards({ ...base, review: false });
  expect(cards.map((card) => card.action)).toEqual(["none", "switch", "current"]);
  expect(cards[1]!.downgrade).toBe(true);
  const held = planCards({ ...base, review: true });
  expect(held.map((card) => card.action)).toEqual(["none", "switch", "current"]);
  const pro = planCards({ ...base, currentPlan: "pro", review: true });
  expect(pro.map((card) => card.action)).toEqual(["none", "current", "none"]);
  expect(canChangePlan(pro)).toBe(false);
  expect(
    canChangePlan(
      planCards({ ...base, plans: [], currentPlan: "free", paid: false, review: false }),
    ),
  ).toBe(false);
});

test("server features win over the client copy", () => {
  const cards = planCards({
    plans: [offer("pro", "monthly", 2000, ["Whatever the server says"])],
    currentPlan: "free",
    paid: false,
    interval: "monthly",
    review: false,
  });
  expect(cards[1]!.features).toEqual(["Whatever the server says"]);
});
