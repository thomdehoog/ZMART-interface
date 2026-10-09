/**
 * The workflows installed on this machine, loaded into the page as it opens.
 *
 * A workflow written in another repository arrives as a package: a folder
 * with a `workflow.json` and a `flow.bundle.js`, installed on the machine
 * with `zmart_interface.register_workflow` (see `docs/writing-a-workflow.md`).
 * The bridge lists what is installed (`GET /api/workflows`) and hands out
 * each package's files (`GET /workflows/<folder>/<file>`). This file asks for
 * the list, fetches each bundle, points its imports of the framework at the
 * page's own modules, loads it, and hands the flow to the page, which adds it
 * to the chooser beside the workflows built into the page. The run that is
 * open is not disturbed.
 *
 * How the imports are pointed. A bundle imports the framework by a bare name,
 * `from "zmart-interface/framework/window/panels.js"`, which no browser can
 * resolve on its own. Import maps would be the textbook answer, but a map has
 * to be in place before the first module loads, and whether this page's
 * browser (WebView2, of whatever version the microscope PC has) honours one
 * added afterwards is not something to find out on a microscope. So the
 * bundle's text is rewritten instead: every such import is pointed at a
 * small module of this page's making, kept as a blob address, which
 * re-exports the live namespace from `globalThis.zmart.runtime`
 * (`runtime.js`). Then the rewritten bundle itself becomes a blob address and
 * is imported. Nothing is evaluated twice: the framework's modules are the
 * page's own, and a step borrowed from a built-in workflow is that workflow's
 * own step.
 *
 * A bundle is refused, with a sentence in the console and the chooser, when
 * it was written for a framework this page is not (`workflow.json`'s
 * `framework` range against the page's version), when its Python half could
 * not be imported by the bridge, or when it imports something the runtime
 * does not have.
 */

import { atBridge } from "./bridge-address.js";
import { satisfies } from "../rules/versions.js";

/* An import of the framework in a bundle's text: `from "zmart-interface/..."`
   after an import or a re-export, a bare `import "zmart-interface/..."`, or
   a dynamic `import("zmart-interface/...")`, which is how a workflow reaches
   a heavy part only when it needs it. The quote is kept so the replacement
   reads as the original did. */
const AN_IMPORT_OF_THE_FRAMEWORK = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])zmart-interface\/([^"']+)\2/g;

/** The names a bundle imports from the framework, each once, in order. */
export function importedFrameworkModules(text) {
  const names = [];
  for (const m of text.matchAll(AN_IMPORT_OF_THE_FRAMEWORK)) {
    if (!names.includes(m[3])) names.push(m[3]);
  }
  return names;
}

/** The bundle's text with every import of the framework pointed at the
    address `urls` gives for its name. A name with no address is left as it
    was, which the browser then refuses by name. */
export function withImportsPointedAt(text, urls) {
  return text.replace(AN_IMPORT_OF_THE_FRAMEWORK, (whole, lead, quote, name) =>
    (urls[name] ? `${lead}${quote}${urls[name]}${quote}` : whole));
}

/** The source of the small module that stands in for one of the framework's
    modules in a bundle: it loads the module from the page's runtime and
    re-exports every name it has. */
export function shimSource(name, exportNames) {
  const lines = [`const r = await globalThis.zmart.load(${JSON.stringify(name)});`];
  for (const key of exportNames) {
    if (key !== "default") lines.push(`export const ${key} = r[${JSON.stringify(key)}];`);
  }
  lines.push('export default r["default"];');
  return `${lines.join("\n")}\n`;
}

const asModuleAddress = (source) =>
  URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

/**
 * What the bridge says is installed: `{ workflows: [...] }`, or null when the
 * page is not served beside a bridge -- during development on the pretend
 * backend, say -- which is nothing to report.
 */
export async function listInstalledWorkflows() {
  try {
    const answer = await fetch(atBridge("/api/workflows"));
    if (!answer.ok) return null;
    const body = await answer.json();
    return Array.isArray(body?.workflows) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Load one installed workflow's bundle and answer its flow, or the sentence
 * it is refused with: `{ folder, name, flow }` or `{ folder, name, refused }`.
 */
export async function loadOneWorkflow(listed, zmart = globalThis.zmart) {
  const { folder, name = folder } = listed;
  const refused = (why) => ({ folder, name, refused: why });
  if (listed.error) return refused(`its Python half could not be imported: ${listed.error}`);
  if (!satisfies(zmart.version, listed.framework)) {
    return refused(`written for framework ${listed.framework}, and this page is ${zmart.version}`);
  }
  try {
    const answer = await fetch(atBridge(listed.bundle));
    if (!answer.ok) return refused(`its bundle could not be fetched (${answer.status})`);
    const text = await answer.text();
    const urls = {};
    for (const imported of importedFrameworkModules(text)) {
      const namespace = await zmart.load(imported);
      urls[imported] = asModuleAddress(shimSource(imported, Object.keys(namespace)));
    }
    const flow = await import(/* @vite-ignore */ asModuleAddress(withImportsPointedAt(text, urls)));
    return { folder, name, flow };
  } catch (why) {
    return refused(`its bundle could not be loaded: ${why.message}`);
  }
}

/**
 * Load every workflow installed on this machine into the page: each one
 * that loads is handed to `register(folder, flow)`, each one refused to
 * `refuse(folder, name, why)`, and the refusal is said in the console too.
 */
export async function loadInstalledWorkflows({ register, refuse }) {
  const listing = await listInstalledWorkflows();
  if (!listing) return [];
  const outcomes = [];
  for (const listed of listing.workflows) {
    if (!listed?.folder || !listed.bundle) continue;
    let outcome = await loadOneWorkflow(listed);
    if (!outcome.refused) {
      /* A bundle that loaded but cannot be made into a workflow -- no steps,
         a panel that fails to build, a folder already taken -- is refused
         like the others, so the packages after it still load and the
         chooser says why this one did not. */
      try {
        register(outcome.folder, outcome.flow);
      } catch (why) {
        outcome = { ...outcome, flow: undefined, refused: `its flow could not be put on the page: ${why.message}` };
      }
    }
    if (outcome.refused) {
      console.warn(`the installed workflow ${outcome.name} was not loaded: ${outcome.refused}`);
      refuse(outcome.folder, outcome.name, outcome.refused);
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
