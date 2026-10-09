/**
 * A workflow from another repository, installed on a machine and used without
 * the page being rebuilt.
 *
 * This is the test Thom named: "Can I install workflows from different repos
 * or different people that share the same framework and shared packages?"
 * The framework's own fixture, `fixtures/three_steps/`, is written exactly as
 * a workflow in another repository would be -- it imports the framework by
 * the bare name `zmart-interface/...`, never by a relative path -- and knows
 * nothing about a microscope. Here it is built into a package with the
 * workflow-bundle build, installed with `zmart_interface.register_workflow`
 * into a ZMART folder of this test's own, served by the real bridge from
 * that folder, and loaded by the built page as the microscope will load it.
 *
 * Then the page is driven as an operator would drive it: the chooser offers
 * the new workflow, its card comes up, its three steps are walked -- one
 * settled by standing, one run, interrupted and run again, one finished --
 * and target acquisition is still there, opening on Connect with the mock.
 * The console has to say nothing throughout.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { buildWorkflowBundle } from "./build/workflow-bundle.mjs";
import { bridgePython, startTheBridge }
  from "../workflows/target_acquisition/steps/scan_the_overview/live-bridge.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures", "three_steps");
const PORT = Number(process.env.INSTALLED_WORKFLOW_PORT ?? 8841);

/* The page under test is the built one the bridge serves, as the microscope
   meets it. `INSTALLED_WORKFLOW_DEV_PAGE=1` drives the development server's
   page instead, told where the bridge is, for working on the loader before
   the page is rebuilt. */
const thePage = (bridge) =>
  (process.env.INSTALLED_WORKFLOW_DEV_PAGE ? `/?bridge=${encodeURIComponent(bridge.at)}` : `${bridge.at}/`);

/** A package of the fixture, built into a folder of its own, with its manifest. */
async function aPackageOf(workflowFolder, manifest) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "zmart-workflow-package-"));
  await buildWorkflowBundle(workflowFolder, folder);
  fs.writeFileSync(path.join(folder, "workflow.json"), JSON.stringify(manifest, null, 2));
  return folder;
}

/** Install a package on the machine the bridge runs on, the way the install guide says to. */
function registerOnTheMachine(packageFolder) {
  const python = bridgePython(
    "-c", "import sys, zmart_interface; print(zmart_interface.register_workflow(sys.argv[1]))", packageFolder,
  );
  return execFileSync(python.command, python.args, { cwd: python.cwd, encoding: "utf8", env: process.env }).trim();
}

let bridge = null;
let machineBefore;

test.beforeAll(async () => {
  test.setTimeout(240_000);
  /* A ZMART folder of this test's own: the library the package goes into,
     and the folder the bridge reads. `startTheBridge` hands the bridge this
     process's environment, so setting it here is what points the bridge
     there. */
  machineBefore = process.env.ZMART_MICROSCOPY_ROOT;
  process.env.ZMART_MICROSCOPY_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "zmart-machine-"));
  const built = await aPackageOf(FIXTURE, {
    folder: "three_steps", name: "Three steps", version: "1.0.0",
    framework: "^0.1.0", bundle: "flow.bundle.js",
  });
  expect(registerOnTheMachine(built)).toBe("three_steps");
  bridge = await startTheBridge({ port: PORT, connect: false });
});

test.afterAll(async () => {
  await bridge?.stop();
  if (machineBefore === undefined) delete process.env.ZMART_MICROSCOPY_ROOT;
  else process.env.ZMART_MICROSCOPY_ROOT = machineBefore;
});

/** Everything the console complained about, kept for the end. */
function keepTheConsole(page) {
  const said = [];
  page.on("pageerror", (why) => said.push(`page error: ${why.message}`));
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) said.push(`${m.type()}: ${m.text()}`); });
  return said;
}

test("a workflow installed from a package plugs in, and the page was never rebuilt", async ({ page }) => {
  test.setTimeout(180_000);
  const said = keepTheConsole(page);
  await page.goto(thePage(bridge));

  /* The chooser offers the installed workflow beside the built-in one. */
  const chooser = page.locator("#wf-select");
  await expect(chooser.locator('option[value="three_steps"]')).toHaveText("Three steps", { timeout: 20_000 });
  await expect(chooser.locator('option[value="target_acquisition"]')).toHaveText("Target acquisition");
  await chooser.selectOption("three_steps");

  /* Choosing it shows its card, and its three steps on the rail. */
  const card = page.locator("#panel-card");
  await expect(card).toBeVisible();
  await expect(card.locator(".side-group-title")).toHaveText("Three steps");
  const line = page.locator("#three-steps-line");
  await expect(line).toHaveText("Nothing counted yet.");
  await expect(page.locator("#steps .step")).toHaveCount(3);
  await expect(page.locator("#tabs .tab")).toHaveText(["Card"]);

  /* Step 1 settles by standing on it. */
  const step = (title) => page.locator("#steps .step", { hasText: title });
  await step("Begin").click();
  await expect(step("Begin")).toHaveClass(/done/);

  /* Step 2 runs; its press says Interrupt while it runs; Stop leaves it
     orange with its note. */
  await step("Count to three").click();
  await expect(step("Count to three")).toHaveClass(/active/);
  const press = page.locator("#foot-card button.step-run");
  const hint = page.locator("#foot-card .action-hint");
  await expect(press).toHaveText("Count");
  await press.click();
  await expect(press).toHaveText("Interrupt");
  await expect(line).toHaveText(/Counting/);
  await press.click();
  await expect(step("Count to three")).toHaveClass(/stale/);
  await expect(hint).toHaveText(/^stopped at [0-2]$/);

  /* Run again finishes, green, with its note. */
  await expect(press).toHaveText("Run again");
  await press.click();
  await expect(hint).toHaveText("counted to 3", { timeout: 15_000 });
  await expect(step("Count to three")).toHaveClass(/done/);
  await expect(step("Count to three")).not.toHaveClass(/stale/);
  await expect(line).toHaveText("Counted to 3.");

  /* Step 3 runs and goes green. */
  await step("Finish").click();
  await expect(press).toHaveText("Finish");
  await press.click();
  await expect(step("Finish")).toHaveClass(/done/);
  await expect(hint).toHaveText("finished");
  await expect(line).toHaveText("Finished.");

  /* Walking back to step 1 shows the card again, and the run as the page
     keeps it carries the workflow's own field beside the framework's. */
  await step("Begin").click();
  await expect(card).toBeVisible();
  const run = await page.evaluate(() => window.__theRunState());
  expect(run.counted).toBe(3);
  expect([...run.done].sort()).toEqual(["begin", "count", "finish"]);

  /* Target acquisition is still offered, and opens on Connect with the mock. */
  await chooser.selectOption("target_acquisition");
  await expect(page.locator("#steps .step")).toHaveCount(10);
  await expect(page.locator(".step.active .step-name")).toHaveText("Connect");
  await expect(page.locator("#panel-canvas")).toBeVisible();
  await expect(card).toBeHidden();
  const microscope = page.locator("#canvas-side select").first();
  await expect(microscope).toHaveValue(/mock/i, { timeout: 20_000 });

  expect(said, "the console said something").toEqual([]);
});

test("a package the page cannot use is refused with a sentence, and the rest still load", async ({ page }) => {
  test.setTimeout(180_000);
  /* Installed while the bridge runs: the library is read when the page asks.
     One package written for a framework this page is not; one whose bundle
     loads but is no workflow, since it declares no steps. */
  const tooNew = await aPackageOf(FIXTURE, {
    folder: "three_steps_too_new", name: "Three steps, too new", version: "2.0.0",
    framework: "^9.0.0", bundle: "flow.bundle.js",
  });
  expect(registerOnTheMachine(tooNew)).toBe("three_steps_too_new");
  const noSteps = fs.mkdtempSync(path.join(os.tmpdir(), "zmart-workflow-package-"));
  fs.writeFileSync(path.join(noSteps, "flow.bundle.js"), 'export const blurb = "a flow with nothing in it";\n');
  fs.writeFileSync(path.join(noSteps, "workflow.json"), JSON.stringify({
    folder: "no_steps", name: "No steps", version: "1.0.0", framework: "*", bundle: "flow.bundle.js",
  }));
  expect(registerOnTheMachine(noSteps)).toBe("no_steps");

  const said = keepTheConsole(page);
  await page.goto(thePage(bridge));
  const chooser = page.locator("#wf-select");
  await expect(chooser.locator('option[value="three_steps"]')).toHaveText("Three steps", { timeout: 20_000 });
  const tooNewEntry = chooser.locator('option[value="refused:three_steps_too_new"]');
  await expect(tooNewEntry).toHaveText("Three steps, too new (not loaded)");
  await expect(tooNewEntry).toBeDisabled();
  await expect(tooNewEntry).toHaveAttribute("title", /written for framework \^9\.0\.0, and this page is 0\.1\.0/);
  const noStepsEntry = chooser.locator('option[value="refused:no_steps"]');
  await expect(noStepsEntry).toHaveText("No steps (not loaded)");
  await expect(noStepsEntry).toHaveAttribute("title", /its flow could not be put on the page/);
  /* And the good package is still there and still works. */
  await chooser.selectOption("three_steps");
  await expect(page.locator("#steps .step")).toHaveCount(3);
  expect(said).toHaveLength(2);
  expect(said.join("\n")).toMatch(/warning: the installed workflow Three steps, too new was not loaded: written for framework \^9\.0\.0/);
  expect(said.join("\n")).toMatch(/warning: the installed workflow No steps was not loaded: its flow could not be put on the page/);
});
