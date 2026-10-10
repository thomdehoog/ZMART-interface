/**
 * Where the installed ZMART viewer keeps the drawing rules this page shares.
 *
 * This page and the viewer's own window draw with the same neuroglancer, and
 * they must draw the same way: the same little shader programs that turn a
 * stored value into a colour, and the same edits to neuroglancer that let a
 * picture keep its transparency and grow while it is on screen. The viewer
 * owns all of these, in its package's `drawing` folder, and this page takes
 * them from there rather than keeping copies of its own. Copies kept in line
 * by hand drifted; one owner cannot.
 *
 * So the viewer has to be installed in the Python that builds the page.
 * `PYTHON=` names that Python when it is not the one on the path.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** The files this page reads from the viewer, all in its `drawing` folder. */
export const THE_SHARED_DRAWING_FILES = [
  "programs.js",
  "neuroglancer-growth.mjs",
  "neuroglancer-patches.mjs",
];

/**
 * The installed viewer's `drawing` folder, checked to hold what this page needs.
 *
 * @throws when the viewer is not installed in that Python, or is too old to
 *   offer every shared file — saying which, and what to install.
 */
export function theViewersDrawingFolder() {
  const folder = execFileSync(process.env.PYTHON || "python", ["-c",
    "from pathlib import Path; import zmart_viewer; " +
    "print(Path(zmart_viewer.__file__).parent / 'drawing')"],
    { encoding: "utf8", windowsHide: true }).trim();
  const missing = THE_SHARED_DRAWING_FILES.filter(name => !existsSync(join(folder, name)));
  if (missing.length) {
    throw new Error(
      `the installed ZMART viewer has no ${missing.join(", ")} in ${folder}. ` +
        "Install a zmart-viewer that ships them, from its release-candidate branch, in " +
        "the Python that builds this page, or name that Python with PYTHON=.",
    );
  }
  return folder;
}
