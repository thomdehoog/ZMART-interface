/**
 * The runtime a workflow from another repository is given: the framework's
 * and the parts' modules, by name, on the page.
 *
 * A workflow written in this repository imports the framework by a relative
 * path, `../../../../framework/window/panels.js`, which ties it to living in
 * this tree. A workflow written somewhere else cannot: it is built on its
 * own into one file, `flow.bundle.js`, and arrives on a microscope PC that
 * never builds anything. So it imports the framework and the parts by one
 * bare name instead, `zmart-interface/<path under zmart_interface/>` --
 * `zmart-interface/framework/window/panels.js`, say -- and leaves those
 * imports unresolved in its bundle. When the page loads such a bundle
 * (`installed-workflows.js`), it points every one of those names at the
 * page's own copy of the module, which is what this file holds.
 *
 * What a workflow may import, and therefore what is here:
 *
 * - the framework's helpers a step reaches for: `framework/window/dom.js`,
 *   `framework/window/panels.js`, `framework/window/status.js`,
 *   `framework/rules/steps.js`;
 * - every part, `parts/**`, which is what any workflow is built from;
 * - the shared files and the step declarations of every workflow in this
 *   repository, `workflows/<name>/shared/*.js` and
 *   `workflows/<name>/steps/<step>/step.js`, so a workflow written elsewhere
 *   can borrow a step rather than retype it (`workflows/README.md`,
 *   "Borrowing steps instead of retyping them").
 *
 * The list is made by the build tool's folder scan, so adding a part or a
 * shared file adds it to the runtime without anybody editing a list. The
 * modules are loaded only when a bundle asks for them: the drawing engines
 * under `parts/canvas/engines/` are heavy and are fetched today only when
 * there is a run to watch, and the runtime keeps that.
 *
 * The page's version sits beside them, for the check a workflow's
 * `workflow.json` asks for (`"framework": "^0.1.0"`).
 */

import { version } from "../../../package.json";

/* Each pattern is relative to this file; the key a workflow uses is the
   path relative to `zmart_interface/`, which `named` works out below. Tests
   and browser specs are not for importing. */
const found = {
  ...import.meta.glob(["./dom.js", "./panels.js", "./status.js"]),
  ...import.meta.glob("../rules/steps.js"),
  ...import.meta.glob(["../../parts/**/*.js", "!../../parts/**/*.test.js", "!../../parts/**/*.spec.js"]),
  ...import.meta.glob(["../../workflows/*/shared/*.js", "!../../workflows/*/shared/*.test.js", "!../../workflows/*/shared/*.spec.js"]),
  ...import.meta.glob("../../workflows/*/steps/*/step.js"),
};

/** The runtime's name for a module found at `path` relative to this file:
    the path under `zmart_interface/`. */
export function named(path) {
  if (path.startsWith("./")) return `framework/window/${path.slice(2)}`;
  if (path.startsWith("../rules/")) return `framework/${path.slice(3)}`;
  if (path.startsWith("../../")) return path.slice(6);
  return path;
}

/** Every module a workflow may import, by the name it imports it under, each
    a function that loads it and answers its namespace. */
export const runtime = Object.fromEntries(
  Object.entries(found).map(([path, load]) => [named(path), load]),
);

/**
 * Put the runtime on the window, as `globalThis.zmart`, where a loaded bundle
 * reaches it: the page's `version`, the `runtime` map, `load(name)` for one
 * module's namespace, and `register(folder, flow)` for a workflow handing
 * itself to the page, which the page answers through `onRegister`.
 */
export function installRuntime({ onRegister }) {
  globalThis.zmart = {
    version,
    runtime,
    /** The namespace of the module a workflow imports as `zmart-interface/<name>`. */
    load(name) {
      const loader = runtime[name];
      if (!loader) return Promise.reject(new Error(`no module zmart-interface/${name} on this page`));
      return loader();
    },
    register: onRegister,
  };
  return globalThis.zmart;
}
