import { describe, expect, it } from "vitest";
import { parseRating, pickDetails, repeatsName } from "../lib/board/rating";

describe("parseRating", () => {
  it.each([
    ["5,00 na 5, 6 ocen produktu", { value: 5, max: 5, count: 6 }],
    ["4,53 na 5, 15 ocen produktu", { value: 4.53, max: 5, count: 15 }],
    ["4.92 out of 5 average rating, 12 reviews", { value: 4.92, max: 5, count: 12 }],
    ["4.5/5 (1,234)", { value: 4.5, max: 5, count: 1234 }],
    ["4 of 5 stars", { value: 4, max: 5 }],
    ["8.6/10", { value: 8.6, max: 10 }],
    ["4,8 z 5 (1 234 opinii)", { value: 4.8, max: 5, count: 1234 }],
  ])("reads %s", (text, expected) => {
    expect(parseRating(text)).toEqual(expected);
  });

  it("never invents a rating", () => {
    expect(parseRating("12 reviews")).toBeNull();
    expect(parseRating("Great value")).toBeNull();
    expect(parseRating("7 out of 5")).toBeNull();
  });
});

describe("pickDetails", () => {
  const facts = [
    { label: "Rating", value: "4,53 na 5, 15 ocen produktu", kind: "text" as const },
    { label: "Vram", value: "Karta graficzna MSI RTX 3090 VENTUS 3X 24G", kind: "text" as const },
    { label: "Memory", value: "24 GB", kind: "text" as const },
  ];
  it("lifts a rating fact out of the facts and drops name echoes", () => {
    const out = pickDetails({ name: "Karta graficzna MSI RTX 3090 VENTUS 3X 24G OC", facts });
    expect(out.rating).toEqual({ value: 4.53, max: 5, count: 15 });
    expect(out.facts.map((fact) => fact.label)).toEqual(["Memory"]);
  });
  it("prefers the structured rating and keeps unreadable rating facts", () => {
    const own = { value: 4.9, max: 5 as const };
    expect(pickDetails({ name: "x", rating: own, facts }).rating).toBe(own);
    const odd = [{ label: "Rating", value: "great", kind: "text" as const }];
    expect(pickDetails({ name: "x", facts: odd })).toEqual({ rating: null, facts: odd });
  });
  it("matches names loosely", () => {
    expect(repeatsName("Hotel Aria", "hotel aria")).toBe(true);
    expect(repeatsName("Hotel Aria", "Pool")).toBe(false);
  });
});
