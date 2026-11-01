import type { AccountOfferV1, AccountPriceV1 } from "$shared/ipc/bindings";
import { IS_MAC } from "$shared/platform";

const media = IS_MAC ? "zephium-media://localhost/" : "http://zephium-media.localhost/";
const TOKEN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

/** The account picture as Rust serves it, by the revision it holds; null shows initials. */
export const avatarUrl = (revision: number | null | undefined) =>
  revision != null && Number.isInteger(revision) && revision > 0
    ? `${media}account-avatar/${revision}`
    : null;
/** A picked picture being framed, staged natively under its token. */
export const stagedAvatarUrl = (token: string) =>
  TOKEN.test(token) ? `${media}account-avatar/staged/${token}` : null;

/** One or two letters for the avatar, from the name or else the address. */
export function initials(email: string | null | undefined, name?: string | null): string {
  const words = (name ?? "").trim().split(/\s+/u).filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words.at(-1)![0]!).toUpperCase();
  if (words.length === 1) return words[0]![0]!.toUpperCase();
  const local = (email ?? "").split("@")[0] ?? "";
  const letter = [...local].find((c) => /\p{L}|\p{N}/u.test(c));
  return letter ? letter.toUpperCase() : "";
}

/** A plan id as the person reads it: `pro` → `Pro`. */
export function planName(plan: string | null | undefined): string | null {
  const id = plan?.trim();
  if (!id) return null;
  return id
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/** The provider's price in the person's locale, or null if it cannot be shown truthfully. */
export function priceLabel(
  price: AccountPriceV1 | null | undefined,
  locale?: string,
): string | null {
  if (!price || !/^[A-Za-z]{3}$/u.test(price.currency)) return null;
  try {
    const format = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: price.currency.toUpperCase(),
    });
    const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
    const amount = price.amount_minor / 10 ** digits;
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: price.currency.toUpperCase(),
      minimumFractionDigits: Number.isInteger(amount) ? 0 : digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return null;
  }
}

/** A day, short and local, with the year only when it is not this one. */
export function shortDate(iso: string | null | undefined, now = new Date(), locale?: string) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}

/** How close the allowance is to running out, for the meter's colour. */
export function usageTone(percent: number | null | undefined): "calm" | "high" | "full" {
  if (percent == null) return "calm";
  if (percent >= 100) return "full";
  return percent >= 80 ? "high" : "calm";
}

export function offerKey(offer: AccountOfferV1): string {
  return offer.kind === "plan" ? `plan:${offer.plan}:${offer.interval}` : `topup:${offer.id}`;
}

const UNITS = /^\d{1,30}$/u;
const FACTOR = /^[1-9]\d{0,11}$/u;

/** A unit count and the server's units-per-credit, when both are well-formed. */
function amounts(
  units: string | null | undefined,
  creditUnits: string | null | undefined,
): { value: bigint; per: bigint } | null {
  if (!units || !UNITS.test(units) || !creditUnits || !FACTOR.test(creditUnits)) return null;
  return { value: BigInt(units), per: BigInt(creditUnits) };
}

const whole = (locale?: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });

/**
 * A balance in whole credits, rounded down so it never promises more than is
 * there. `creditUnits` is the server's units to one credit; without it there
 * is no credit to state, and the answer is null.
 */
export function creditsLeft(
  units: string | null | undefined,
  creditUnits: string | null | undefined,
  locale?: string,
): string | null {
  const at = amounts(units, creditUnits);
  return at ? whole(locale).format(at.value / at.per) : null;
}

/** A total, such as a task's cost, in whole credits; a little is "<1", never "0". */
export function creditsTotal(
  units: string | null | undefined,
  creditUnits: string | null | undefined,
  locale?: string,
): string | null {
  const at = amounts(units, creditUnits);
  if (!at) return null;
  if (at.value === 0n) return whole(locale).format(0);
  const rounded = (at.value * 2n + at.per) / (at.per * 2n);
  return rounded === 0n ? `<${whole(locale).format(1)}` : whole(locale).format(rounded);
}

/** One call's cost to a hundredth of a credit; below that, "<0.01". Never rounded to whole credits. */
export function creditsCall(
  units: string | null | undefined,
  creditUnits: string | null | undefined,
  locale?: string,
): string | null {
  const at = amounts(units, creditUnits);
  if (!at) return null;
  const format = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  if (at.value === 0n) return format.format(0);
  const hundredths = (at.value * 200n + at.per) / (at.per * 2n);
  return hundredths === 0n ? `<${format.format(0.01)}` : format.format(Number(hundredths) / 100);
}

/** Unit counts added exactly; anything that is not a count is ignored. */
export function sumUnits(values: ReadonlyArray<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) if (value && UNITS.test(value)) total += BigInt(value);
  return total.toString();
}

/** Whole credits the person typed, as units; null if it is not a plain count. */
export function creditsToUnits(
  text: string,
  creditUnits: string | null | undefined,
): string | null {
  const digits = text.trim();
  if (!/^\d{1,9}$/u.test(digits) || !creditUnits || !FACTOR.test(creditUnits)) return null;
  return (BigInt(digits) * BigInt(creditUnits)).toString();
}

/** Units as the whole credits a field shows; null without the factor. */
export function unitsToCredits(
  units: string | null | undefined,
  creditUnits: string | null | undefined,
): string | null {
  const at = amounts(units, creditUnits);
  return at ? (at.value / at.per).toString() : null;
}

/** Whether a unit amount is above zero. */
export function positive(units: string | null | undefined): boolean {
  return !!units && UNITS.test(units) && BigInt(units) > 0n;
}

/** How a hosted request's accounting reads; only `settled` is a final charge. */
export function requestStanding(state: string): "charged" | "free" | "checking" | "running" {
  if (state === "settled") return "charged";
  if (state === "released") return "free";
  if (state === "usage_unknown") return "checking";
  return "running";
}
