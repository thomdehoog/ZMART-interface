/**
 * The area the page lays the stage out on comes from `get_xyz`'s `reach`:
 * everywhere a picture can show along each axis, in the micrometres the
 * stage counts in. A driver that does not say is told so, in words.
 */

import { describe, expect, it } from "vitest";
import { theReachOf } from "./reach.js";

const reading = (reach = {}) => Object.fromEntries(["x", "y", "z"].map((axis) => [axis, {
  value: 0, unit: "um", range: [0, 100],
  ...(reach[axis] === undefined ? { reach: [-5, 105] } : reach[axis] ? { reach: reach[axis] } : {}),
}]));

describe("the reach the page lays the stage out on", () => {
  it("is get_xyz's reach, axis by axis", () => {
    expect(theReachOf(reading({ x: [-32, 132], y: [-10, 90], z: [-2, 102] }))).toEqual({
      x_um: [-32, 132], y_um: [-10, 90], z_um: [-2, 102],
    });
  });

  it("names the axis a driver gave no reach for", () => {
    expect(() => theReachOf(reading({ y: null }))).toThrow(
      /does not say how far its pictures reach along y/,
    );
  });

  it("refuses a reach that is not two numbers, smallest first", () => {
    expect(() => theReachOf(reading({ x: [10, -10] }))).toThrow(/along x/);
    expect(() => theReachOf(reading({ x: ["a", 1] }))).toThrow(/along x/);
  });

  it("says plainly when there is no reading at all", () => {
    expect(() => theReachOf(null)).toThrow(/along x/);
  });
});
