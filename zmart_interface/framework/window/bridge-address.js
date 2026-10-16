/**
 * Where the bridge answers, as the page knows it.
 *
 * On the microscope one Python process serves the page and the bridge
 * together, so a route is asked for at the page's own address and this adds
 * nothing. During development the Vite server holds the page instead, and
 * `?bridge=http://127.0.0.1:8600` on the page's address says where the
 * bridge is. One fact, read once: the microscope seam (`parts/microscope/
 * live.js`) and the framework's loader of installed workflows both ask it,
 * and two copies of a fact drift apart in silence.
 */

const WHERE =
  new URLSearchParams(globalThis.location?.search ?? "").get("bridge") ?? "";

/** A bridge route as an address the page can fetch or put in an `img`: the
    route itself on the microscope, prefixed with the bridge's origin when
    the dev server holds the page. Pictures the bridge serves need this as
    much as the JSON calls do -- an `img` asks the page's own origin
    otherwise, and the dev server answers with the page. */
export const atBridge = (route) => `${WHERE}${route}`;
