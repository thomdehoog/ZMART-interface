/**
 * Where pictures can show: the area the page lays the stage out on.
 *
 * The controller's `get_xyz` reports, per axis, `range` — how far the stage
 * can travel — and `reach` — everywhere a picture can show along that axis.
 * A picture taken at the edge of travel still shows half a field beyond it,
 * so reach is the travel widened by half the widest field (x, y) and half the
 * deepest stack (z). The page and the viewer lay the specimen area out from
 * it before the first picture, so nothing has to grow or shift once pictures
 * arrive. The driver works it out; the page only reads it.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

/**
 * `{ x_um, y_um, z_um }`, each `[min, max]` in micrometres, from one
 * `get_xyz` reading. Throws a sentence the operator can act on when the
 * driver gives no usable reach on an axis: drawing an area somebody guessed
 * would put pictures where they were not taken.
 */
export function theReachOf(reading) {
  const area = {};
  for (const axis of ["x", "y", "z"]) {
    const reach = reading?.[axis]?.reach;
    if (!Array.isArray(reach) || reach.length !== 2
        || !reach.every(isNumber) || reach[0] > reach[1]) {
      throw new Error(
        `the microscope's driver does not say how far its pictures reach along ${axis} `
        + "(get_xyz gives no usable 'reach'), so the stage cannot be laid out; "
        + "the driver needs updating to the controller's current contract",
      );
    }
    area[`${axis}_um`] = [reach[0], reach[1]];
  }
  return area;
}
