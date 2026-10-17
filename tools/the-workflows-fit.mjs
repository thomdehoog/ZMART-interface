/**
 * Whether every workflow the build finds was written for this workflow API.
 *
 * Each workflow folder says, in its `workflow.json`, which versions of the API
 * it works with: `"api": "^0.1.0"`. The build compares that with the API's own
 * version (`zmart_interface/api/version.json`) before it builds anything, and
 * stops with a sentence naming the workflow when one does not fit, rather than
 * building a page that half works. The development server checks the same at
 * start. There is one build for the page and the Python halves, so the Python
 * half of a workflow is not checked again.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import fs from "node:fs";
import path from "node:path";
import { satisfies } from "../zmart_interface/framework/rules/versions.js";

/** What is wrong with each workflow folder under `workflows`, in sentences; empty when every one fits `apiVersion`. */
export function workflowsThatDoNotFit(apiVersion, workflows) {
  const wrong = [];
  for (const folder of fs.readdirSync(workflows, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    const at = path.join(workflows, folder.name);
    const isAWorkflow = ["flow.js", "flow.ts"].some((name) => fs.existsSync(path.join(at, name)));
    if (!isAWorkflow) continue;
    const declared = path.join(at, "workflow.json");
    if (!fs.existsSync(declared)) {
      wrong.push(`the workflow ${folder.name} has no workflow.json saying which workflow API it works with`);
      continue;
    }
    let range;
    try {
      range = JSON.parse(fs.readFileSync(declared, "utf8")).api;
    } catch (why) {
      wrong.push(`the workflow ${folder.name}'s workflow.json cannot be read: ${why.message}`);
      continue;
    }
    if (typeof range !== "string" || !range.trim()) {
      wrong.push(`the workflow ${folder.name}'s workflow.json names no "api" range`);
    } else if (!satisfies(apiVersion, range)) {
      wrong.push(`the workflow ${folder.name} works with workflow API ${range}, and this interface's is ${apiVersion}`);
    }
  }
  return wrong;
}

/** The API's own version, as its version file states it. */
export function theApiVersion(api) {
  return JSON.parse(fs.readFileSync(path.join(api, "version.json"), "utf8")).version;
}

/** The build's check, as a Vite plugin: it stops the build, and the development server, with the sentences above. */
export function theWorkflowsFitTheApi({ workflows, api }) {
  return {
    name: "zmart:the-workflows-fit-the-api",
    buildStart() {
      const wrong = workflowsThatDoNotFit(theApiVersion(api), workflows);
      if (wrong.length) this.error(wrong.join("\n"));
    },
  };
}
