/**
 * Build a workflow written in another repository into one file the page can
 * load: `flow.bundle.js`, beside its `workflow.json`.
 *
 * A workflow is a folder with a `flow.js` in it, which imports the framework
 * and the parts by the bare name `zmart-interface/<path>` (see
 * `docs/writing-a-workflow.md`). This script folds the workflow's own files
 * -- its steps, its shared code, any markup it reads in as text -- into one
 * module, and leaves every `zmart-interface/...` import exactly as written:
 * the page answers those from its own modules when it loads the bundle
 * (`framework/window/runtime.js`). The result is a package the page can take
 * without being rebuilt, which is the whole point: the microscope PC never
 * builds anything.
 *
 * Run it from a checkout of this repository, where Vite is installed, and
 * point it at the workflow's folder and where the package should go:
 *
 *     node zmart_interface/framework/build/workflow-bundle.mjs <workflow folder> <out folder>
 *
 * Afterwards `<out folder>` holds `flow.bundle.js` and a copy of the
 * workflow's `workflow.json`, and `zmart_interface.register_workflow(<out
 * folder>)` installs it on a machine. The workflow's `workflow.json` says
 * what to call the folder, which framework it was written for, and whether a
 * Python module registers routes for it.
 *
 * Node resolves `vite` from beside this script, so the framework's own copy is
 * used whichever folder the workflow lives in.
 */

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

/** The bare name a workflow imports the framework by; left unresolved. */
export const THE_FRAMEWORKS_BARE_NAME = /^zmart-interface\//;

/** What the bundle is called, as `workflow.json` names it by default. */
export const THE_BUNDLE = "flow.bundle.js";

/**
 * The Vite configuration the bundle is built with: library mode, one ES
 * module, the framework's imports external, and the workflow's own folder as
 * the root so its relative imports and `?raw` files resolve.
 */
export function workflowBundleConfig(workflowFolder, outFolder) {
  const root = path.resolve(workflowFolder);
  return {
    configFile: false,
    root,
    base: "./",
    logLevel: "warn",
    build: {
      lib: {
        entry: path.join(root, "flow.js"),
        formats: ["es"],
        fileName: () => THE_BUNDLE,
      },
      outDir: path.resolve(outFolder),
      emptyOutDir: false,
      /* Readable, so a workflow author can open the bundle and see their own
         code in it; the page is not short of bytes. */
      minify: false,
      cssCodeSplit: false,
      rollupOptions: {
        external: THE_FRAMEWORKS_BARE_NAME,
      },
    },
  };
}

/**
 * Build the workflow at `workflowFolder` into `outFolder`: `flow.bundle.js`,
 * and its `workflow.json` copied beside it when the folder has one.
 */
export async function buildWorkflowBundle(workflowFolder, outFolder) {
  const flow = path.join(path.resolve(workflowFolder), "flow.js");
  if (!existsSync(flow)) throw new Error(`no flow.js in ${workflowFolder}: a workflow is a folder with one`);
  mkdirSync(path.resolve(outFolder), { recursive: true });
  await build(workflowBundleConfig(workflowFolder, outFolder));
  const manifest = path.join(path.resolve(workflowFolder), "workflow.json");
  if (existsSync(manifest)) copyFileSync(manifest, path.join(path.resolve(outFolder), "workflow.json"));
  return path.join(path.resolve(outFolder), THE_BUNDLE);
}

/* Run as a script: the two folders from the command line. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [workflowFolder, outFolder] = process.argv.slice(2);
  if (!workflowFolder || !outFolder) {
    console.error("usage: node workflow-bundle.mjs <workflow folder> <out folder>");
    process.exit(2);
  }
  const built = await buildWorkflowBundle(workflowFolder, outFolder);
  console.log(`built ${built}`);
}
