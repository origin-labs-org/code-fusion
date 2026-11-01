import { describe, expect, it } from "vitest";
import { neighbour, position, STEPS, stepsFor } from "../lib/flow";

describe("flow", () => {
  it("walks welcome, then six steps, ending ready", () => {
    expect(STEPS).toEqual(["welcome", "import", "essentials", "launcher", "work", "ai", "ready"]);
  });

  it("counts from the first real step, welcome being the door", () => {
    expect(position("import")).toEqual({ at: 1, of: 6 });
    expect(position("ready")).toEqual({ at: 6, of: 6 });
  });

  it("never steps back through the door or past the end", () => {
    expect(neighbour("import", -1)).toBeUndefined();
    expect(neighbour("import", 1)).toBe("essentials");
    expect(neighbour("ready", 1)).toBeUndefined();
  });
});

describe("flow without Work and AI", () => {
  it("skips Work and its models, and counts what is left", () => {
    expect(stepsFor(false)).not.toContain("work");
    expect(stepsFor(false)).not.toContain("ai");
    expect(position("ready", false)).toEqual({ at: 4, of: 4 });
    expect(neighbour("launcher", 1, false)).toBe("ready");
    expect(neighbour("ready", -1, false)).toBe("launcher");
  });
});
