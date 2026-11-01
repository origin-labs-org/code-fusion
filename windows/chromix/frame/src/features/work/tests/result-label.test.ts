import { expect, test } from "vitest";
import { pageLabel, resultLabel, sharedSite } from "../lib/run/result-label";

const page = (url: string, title: string) => ({ url, where: new URL(url).hostname, title });

test("a titled result keeps its title and names its site only when the list is mixed", () => {
  const row = page("https://www.ycombinator.com/apply", "Apply to YC | Y Combinator");
  expect(resultLabel(row)).toEqual({ text: "Apply to YC | Y Combinator", site: "ycombinator.com" });
  expect(resultLabel(page("https://a.com/x", "Pricing"))).toEqual({
    text: "Pricing",
    site: "a.com",
  });
  expect(resultLabel(page("https://a.com/x", "Pricing"), true).site).toBe("");
});

test("a result with no title is named by its address, never the host twice", () => {
  expect(resultLabel(page("https://reddit.com", "reddit.com"))).toEqual({
    text: "reddit.com",
    site: "",
  });
  expect(
    resultLabel(page("https://allegro.pl/listing/rtx-3090-24gb?id=1", "allegro.pl"), true),
  ).toEqual({ text: "allegro.pl › listing › rtx 3090 24gb", site: "" });
  expect(resultLabel(page("https://allegro.pl/listing?q=rtx+3090", "")).text).toBe(
    "allegro.pl › rtx 3090",
  );
});

test("a list headed by its site shows titles, else the address past the host", () => {
  expect(pageLabel(page("https://allegro.pl/oferta/rtx-3090", "allegro.pl"))).toBe(
    "oferta › rtx 3090",
  );
  expect(pageLabel(page("https://allegro.pl/x", "Rtx 3090 24gb"))).toBe("Rtx 3090 24gb");
});

test("one site is named once, a mix or a file is not", () => {
  expect(sharedSite([{ host: "a.com" }, { host: "a.com" }])).toBe("a.com");
  expect(sharedSite([{ host: "a.com" }])).toBe("");
  expect(sharedSite([{ host: "a.com" }, { host: "b.com" }])).toBe("");
  expect(sharedSite([{ host: "a.com" }, { host: "a.com", file: {} }])).toBe("");
});
