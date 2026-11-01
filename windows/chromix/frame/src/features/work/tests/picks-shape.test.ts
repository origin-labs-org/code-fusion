import { describe, expect, it } from "vitest";
import { comparable } from "../components/objects/centre";
import { pickCandidates } from "../lib/link-media";
import { unrepeated } from "../lib/board/text";
import type { PicksView, PickView } from "../lib/board/types";

const pick = (name: string, extra: Partial<PickView> = {}): PickView => ({
  name,
  facts: [],
  tags: [],
  recommended: false,
  ...extra,
});
const set = (facet: PicksView["facet"], items: PickView[]): PicksView => ({
  id: "p",
  kind: "picks",
  facet,
  items,
});

describe("picks shape", () => {
  it("offers Compare only for things that line up", () => {
    const priced = (name: string) => pick(name, { price: { display: "$1" } });
    expect(comparable(set("product", [priced("A"), priced("B")]))).toBe(true);
    expect(comparable(set("video", [priced("A"), priced("B")]))).toBe(false);
    expect(comparable(set("other", [pick("PR #1"), pick("Author and date")]))).toBe(false);
    const fact = (label: string) => ({ label, value: "x", kind: "text" as const });
    const shared = [fact("VRAM"), fact("Condition")];
    expect(
      comparable(set("other", [pick("A", { facts: shared }), pick("B", { facts: shared })])),
    ).toBe(true);
  });

  it("uses observed candidates and never guesses a video thumbnail", () => {
    expect(pickCandidates({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })).toEqual([]);
    expect(
      pickCandidates({
        media_attempted: true,
        image_candidates: ["https://images.example/private.jpg"],
      }),
    ).toEqual([]);
    expect(
      pickCandidates({ image_candidates: ["https://a.test/x.jpg"], url: "https://youtu.be/x" }),
    ).toEqual(["https://a.test/x.jpg"]);
    expect(pickCandidates({ url: "https://example.com" })).toEqual([]);
  });
});

describe("a pick's price", () => {
  it("says a figure the page repeated once", () => {
    expect(unrepeated("$2,956 $2,956 monthly, originally $3,051")).toBe(
      "$2,956 monthly, originally $3,051",
    );
    expect(unrepeated("€32.50 / item €32.50 / item")).toBe("€32.50 / item");
    expect(unrepeated("$4,446 $4,446")).toBe("$4,446");
    expect(unrepeated("$1,521 round trip")).toBe("$1,521 round trip");
    expect(unrepeated("1 1/2 cups")).toBe("1 1/2 cups");
    expect(unrepeated("$20 $25")).toBe("$20 $25");
  });
});
