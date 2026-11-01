import { expect, test } from "vitest";
import { layoutAnchor } from "../anchor";

test("a pressed trigger is measured at its layout box, not its scaled one", () => {
  const trigger = document.createElement("button");
  trigger.style.cssText =
    "position:fixed;left:100px;top:50px;width:200px;height:40px;border:0;padding:0";
  document.body.append(trigger);
  const anchor = layoutAnchor(trigger)!;
  const rest = anchor.getBoundingClientRect();
  trigger.style.scale = "0.97";
  const pressed = anchor.getBoundingClientRect();
  trigger.remove();
  expect(pressed.x).toBeCloseTo(rest.x, 3);
  expect(pressed.y).toBeCloseTo(rest.y, 3);
  expect(pressed.width).toBeCloseTo(200, 3);
  expect(pressed.height).toBeCloseTo(40, 3);
});

test("there is no anchor without a trigger", () => {
  expect(layoutAnchor(null)).toBeNull();
});
