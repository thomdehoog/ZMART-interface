/**
 * Three small helpers for the page's own markup, shared by everything that
 * draws: finding an element by its id, reading a colour or a size the
 * stylesheet defines, and sizing a canvas to the box it sits in.
 *
 * They are plain functions of the document, with no knowledge of any step,
 * which is why they live here rather than on the page object.
 */

/** The element with this id, or null. */
export const el = (id) => document.getElementById(id);

/** The value of a CSS variable on the root, such as `--accent`, trimmed. */
export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * Size a canvas to the box it sits in, at the screen's own pixel density.
 *
 * A canvas has two sizes: the box it takes on the page, and the number of
 * pixels it draws into. On a high-resolution screen the second is larger, and
 * a canvas left at one pixel per CSS pixel draws blurry. This matches the two,
 * sets the drawing scale accordingly, and remembers the box's size on the
 * canvas (`cssW`, `cssH`) for whoever draws next. Answers false when the box
 * has no size yet, which is what a hidden panel's canvas reports.
 */
export function sizeCanvas(cv) {
  const host = cv.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return false;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cv.cssW = w; cv.cssH = h;
  return true;
}
