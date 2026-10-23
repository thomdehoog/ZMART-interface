/**
 * The Connect card for a driver whose connection names a host, a password
 * and a config: each is shown for the operator to fill, the host and the
 * config with what the driver saved, the password empty, and the output
 * folder with where the last run went. Connect hands all of it to the
 * bridge. The bridge here is the page's own requests, answered by the test:
 * no driver on this machine names these settings.
 */
import { test, expect } from "@playwright/test";

/** An address nothing answers at: every request the test cares about is answered by it. */
const BRIDGE = "http://127.0.0.1:9";

test("a driver's named settings are shown filled, and handed over on Connect", async ({ page }) => {
  await page.route(`${BRIDGE}/api/target_acquisition/instruments`, (route) => route.fulfill({
    json: {
      instruments: [
        { name: "interface-mock", settings: {} },
        { name: "stellaris", settings: { api_type: "Navigator Expert", host: "10.0.0.5", password: null, config: null } },
      ],
      output_root: "D:/runs",
    },
  }));
  await page.route(`${BRIDGE}/api/target_acquisition/protocols`, (route) => route.fulfill({ json: { protocols: [] } }));
  const sent: Record<string, unknown>[] = [];
  await page.route(`${BRIDGE}/api/target_acquisition/connect`, (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ json: { error: "the test opens no session" } });
  });
  await page.route(`${BRIDGE}/api/target_acquisition/disconnect`, (route) => route.fulfill({ json: { closed: true } }));
  await page.goto(`/?bridge=${encodeURIComponent(BRIDGE)}`);

  const rows = page.locator(".session-form .field");
  const field = (name: string) => rows.filter({ hasText: name }).locator("input");
  await page.locator(".field select").first().selectOption({ label: "stellaris" });

  await expect(rows.nth(1)).toHaveText(/^API\s*Navigator Expert$/);
  await expect(field("Host")).toBeEnabled();
  await expect(field("Host")).toHaveValue("10.0.0.5");
  await expect(field("Password")).toBeEnabled();
  await expect(field("Password")).toHaveAttribute("type", "password");
  await expect(field("Password")).toHaveValue("");
  await expect(field("Config")).toBeEnabled();
  await expect(field("Config")).toHaveValue("");
  await expect(field("Output folder")).toHaveValue("D:/runs");

  await field("Host").fill("10.0.0.9");
  await field("Password").fill("hunter2");
  await field("Config").fill("C:/scope/setup.xml");
  await page.locator(".session-foot button.run").click();
  await expect(page.locator(".check-row.failed")).toContainText("the test opens no session");
  expect(sent).toEqual([{
    instrument: "stellaris", host: "10.0.0.9", config: "C:/scope/setup.xml", password: "hunter2",
    output_root: "D:/runs", experiment: "target-acquisition",
  }]);

  // another microscope brings its own driver's settings: the mock needs none of them
  await page.locator(".field select").first().selectOption("interface-mock");
  await expect(field("Host")).toBeDisabled();
  await expect(field("Host")).toHaveAttribute("placeholder", "not needed");
});
