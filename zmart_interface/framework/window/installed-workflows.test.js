/* Loading a workflow package into the page: the pure parts, which rewrite a
   bundle's imports of the framework and decide whether a package may be
   loaded at all. The loading itself needs a browser and is the
   installed-workflow browser test's business. */

import { describe, it, expect } from "vitest";
import {
  importedFrameworkModules, loadOneWorkflow, shimSource, withImportsPointedAt,
} from "./installed-workflows.js";

const A_BUNDLE = `import { sideGroup } from "zmart-interface/framework/window/panels.js";
import { el as e, css } from 'zmart-interface/framework/window/dom.js';
import "zmart-interface/parts/canvas/panel.js";
export { connect } from "zmart-interface/workflows/target_acquisition/steps/connect/step.js";
import { sideGroup as again } from "zmart-interface/framework/window/panels.js";
import somethingElse from "./not-the-framework.js";
const engine = () => import("zmart-interface/parts/canvas/engines.js");
const later = await import( 'zmart-interface/parts/canvas/viewer.js' );
`;

describe("what a bundle imports from the framework", () => {
  it("is read off its import lines, each name once, in order", () => {
    expect(importedFrameworkModules(A_BUNDLE)).toEqual([
      "framework/window/panels.js",
      "framework/window/dom.js",
      "parts/canvas/panel.js",
      "workflows/target_acquisition/steps/connect/step.js",
      "parts/canvas/engines.js",
      "parts/canvas/viewer.js",
    ]);
  });

  it("includes a dynamic import, which is how a heavy part is reached late", () => {
    const pointed = withImportsPointedAt(A_BUNDLE, {
      "parts/canvas/engines.js": "blob:engines",
      "parts/canvas/viewer.js": "blob:viewer",
    });
    expect(pointed).toContain('import("blob:engines")');
    expect(pointed).toContain("import( 'blob:viewer' )");
  });

  it("leaves the bundle's own relative imports alone", () => {
    expect(importedFrameworkModules(A_BUNDLE)).not.toContain("./not-the-framework.js");
  });
});

describe("pointing a bundle's imports at the page's modules", () => {
  it("replaces each name with its address and keeps the quotes as written", () => {
    const pointed = withImportsPointedAt(A_BUNDLE, {
      "framework/window/panels.js": "blob:panels",
      "framework/window/dom.js": "blob:dom",
    });
    expect(pointed).toContain('import { sideGroup } from "blob:panels";');
    expect(pointed).toContain("import { el as e, css } from 'blob:dom';");
    expect(pointed).toContain('import { sideGroup as again } from "blob:panels";');
    /* A name with no address is left, so the browser refuses it by name. */
    expect(pointed).toContain('import "zmart-interface/parts/canvas/panel.js";');
    expect(pointed).toContain('import somethingElse from "./not-the-framework.js";');
  });
});

describe("the small module that stands in for one of the framework's", () => {
  it("loads the module from the runtime and re-exports every name", () => {
    const source = shimSource("framework/window/panels.js", ["sideGroup", "buildThePanels", "default"]);
    expect(source).toContain('await globalThis.zmart.load("framework/window/panels.js")');
    expect(source).toContain('export const sideGroup = r["sideGroup"];');
    expect(source).toContain('export const buildThePanels = r["buildThePanels"];');
    expect(source.match(/export default/g)).toHaveLength(1);
  });
});

describe("whether a package may be loaded", () => {
  const listed = (over) => ({
    folder: "three_steps", name: "Three steps", version: "1.0.0",
    bundle: "/workflows/three_steps/flow.bundle.js", framework: "^0.1.0", ...over,
  });
  const page = { version: "0.1.0-rc.1", load: async () => ({}) };

  it("refuses one written for another framework, saying both versions", async () => {
    const outcome = await loadOneWorkflow(listed({ framework: "^0.2.0" }), page);
    expect(outcome.refused).toMatch(/written for framework \^0\.2\.0/);
    expect(outcome.refused).toMatch(/this page is 0\.1\.0-rc\.1/);
    expect(outcome.name).toBe("Three steps");
  });

  it("refuses one whose Python half the bridge could not import", async () => {
    const outcome = await loadOneWorkflow(listed({ error: "No module named 'nowhere'" }), page);
    expect(outcome.refused).toMatch(/Python half could not be imported: No module named 'nowhere'/);
  });

  it("refuses one whose range nobody can read", async () => {
    const outcome = await loadOneWorkflow(listed({ framework: "latest" }), page);
    expect(outcome.refused).toBeTruthy();
  });
});
