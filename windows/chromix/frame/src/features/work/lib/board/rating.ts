import type { PickView } from "./types";

export type Rating = NonNullable<PickView["rating"]>;
type Fact = PickView["facts"][number];

const LABEL =
  /^(rating|ratings|ocena|oceny|opinie|reviews?|review score|stars?|score|bewertung|avis|note)\b/iu;

/** "4,5", "1 234" and "1,234" as numbers: a lone separator before 1-2 digits is a decimal. */
function figure(text: string): number | null {
  const compact = text.replace(/\s/gu, "");
  const decimal = /^(\d+)[.,](\d{1,2})$/u.exec(compact);
  if (decimal) return Number(`${decimal[1]}.${decimal[2]}`);
  const grouped = compact.replace(/[.,](?=\d{3}\b)/gu, "");
  return /^\d+$/u.test(grouped) ? Number(grouped) : null;
}

const SCORE = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:na|out\s+of|of|z|von|sur|\/)\s*(5|10)\b/iu;
const COUNT =
  /(?:\(\s*(\d[\d\s.,]*)\s*\)|(\d[\d\s.,]*?)\s*(?:ocen\w*|opini\w*|recenz\w*|reviews?|ratings?|votes?|bewertungen|avis))/iu;

/**
 * A rating as the page words it: "5,00 na 5, 6 ocen produktu", "4.92 out of 5
 * average rating, 12 reviews", "4.5/5 (1,234)". Null when no score out of 5
 * or 10 can be read; a count alone is never a rating.
 */
export function parseRating(text: string): Rating | null {
  const score = SCORE.exec(text);
  if (!score) return null;
  const value = figure(score[1]!);
  const max = Number(score[2]) === 10 ? 10 : 5;
  if (value === null || value > max) return null;
  const found = COUNT.exec(text.slice(score.index + score[0].length));
  const count = found ? figure((found[1] ?? found[2] ?? "").trim()) : null;
  return { value, max, ...(count ? { count } : {}) };
}

const flat = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** A fact whose value only restates the record's name is noise, not a fact. */
export function repeatsName(name: string, value: string): boolean {
  const a = flat(name);
  const b = flat(value);
  return b.length > 0 && (a === b || (b.length > 12 && (a.includes(b) || b.includes(a))));
}

/**
 * What a pick shows: its own rating, else one read from a rating-like fact
 * (which then is not also listed as text), and its facts without the ones that
 * repeat its name. A rating is never made up.
 */
export function pickDetails(pick: Pick<PickView, "name" | "rating" | "facts">): {
  rating: Rating | null;
  facts: readonly Fact[];
} {
  const source = pick.facts.find(
    (fact) => LABEL.test(fact.label.trim()) && parseRating(fact.value),
  );
  return {
    rating: pick.rating ?? (source ? parseRating(source.value) : null),
    facts: pick.facts.filter((fact) => fact !== source && !repeatsName(pick.name, fact.value)),
  };
}
