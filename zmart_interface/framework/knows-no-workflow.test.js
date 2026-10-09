/* The framework knows no workflow, and no instrument.
 *
 * `framework/` is the engine: it runs whatever workflow it is handed and
 * asks the workflow's declarations for everything particular. That rule
 * used to be broken quietly -- the run document imported the workflow's
 * carrier geometry, the page imported the microscope's two backends -- and
 * nothing said so until the second workflow was tried. This test reads the
 * framework's source files and refuses an import of anything under
 * `workflows/` or `parts/microscope/`, so the tie cannot come back without a
 * red test saying where.
 *
 * The tests beside the framework are left out: a test about the rail may
 * drive it with a real workflow's steps, which is what the test is for. */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FOLDERS = ["window", "rules"];

/* A static import's source: `import ... from "..."`, `import "..."`, and a
   re-export's `export ... from "..."`. A dynamic `import("...")` too. The
   build tool's folder scan, `import.meta.glob("...")`, is not an import of
   anything in particular and is left alone. */
const IMPORTED_FROM = /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

const sourceFiles = (folder) => readdirSync(join(HERE, folder))
  .filter((name) => name.endsWith(".js") && !name.endsWith(".test.js") && !name.endsWith(".spec.js"))
  .map((name) => join(HERE, folder, name));

const importsOf = (file) => {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORTED_FROM)].map((m) => m[1] ?? m[2] ?? m[3]);
};

describe("the framework imports nothing of any workflow or instrument", () => {
  const files = FOLDERS.flatMap(sourceFiles);

  it("has files to read", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${relative(HERE, file).replaceAll("\\", "/")} stays agnostic`, () => {
      for (const from of importsOf(file)) {
        expect(from, `${relative(HERE, file)} imports ${from}`).not.toMatch(/(^|\/)workflows\//);
        expect(from, `${relative(HERE, file)} imports ${from}`).not.toMatch(/(^|\/)parts\/microscope\//);
      }
    });
  }
});
