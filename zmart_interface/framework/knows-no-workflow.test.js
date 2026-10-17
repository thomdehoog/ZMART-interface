/* The framework and the parts know no workflow.
 *
 * `framework/` is the engine: it runs whatever workflow it is handed and
 * asks the workflow's declarations for everything particular. `parts/` is a
 * toolbox any workflow may use. Neither may lean on one workflow, or that
 * workflow could not be taken out, and another could not be dropped in
 * beside it. That rule used to be broken quietly -- the run document imported
 * the workflow's carrier geometry, the page imported the microscope's two
 * backends, the canvas tests borrowed a workflow's helpers -- and nothing
 * said so until it was tried. This test reads every file under `framework/`
 * and `parts/`, their tests included, and refuses an import of anything under
 * `workflows/`, so the tie cannot come back without a red test saying where.
 * `parts/` holds no page code today -- a part arrives when a second workflow
 * needs it -- so its half of the test may have nothing to read. */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");

/* A static import's source: `import ... from "..."`, `import "..."`, and a
   re-export's `export ... from "..."`. A dynamic `import("...")` too. The
   build tool's folder scan, `import.meta.glob("...")`, is not an import of
   anything in particular and is left alone. A stylesheet's `@import` is. */
const IMPORTED_FROM = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|@import\s+(?:url\()?\s*["']([^"']+)["']/g;

const sourceFiles = (folder) => readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
  const at = join(folder, entry.name);
  if (entry.isDirectory()) return entry.name === "__pycache__" ? [] : sourceFiles(at);
  return /\.(m?js|ts|css)$/.test(entry.name) ? [at] : [];
});

const importsOf = (file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORTED_FROM)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
};

const name = (file) => relative(PACKAGE, file).replaceAll("\\", "/");

describe("the framework imports nothing of any workflow", () => {
  const files = sourceFiles(HERE);

  it("has files to read", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${name(file)} stays agnostic`, () => {
      for (const from of importsOf(file)) {
        expect(from, `${name(file)} imports ${from}`).not.toMatch(/(^|\/)workflows\//);
      }
    });
  }
});

it("the parts import nothing of any workflow", () => {
  for (const file of sourceFiles(join(PACKAGE, "parts"))) {
    for (const from of importsOf(file)) {
      expect(from, `${name(file)} imports ${from}`).not.toMatch(/(^|\/)workflows\//);
    }
  }
});
