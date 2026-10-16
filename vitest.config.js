import path from "node:path";
import { defineConfig } from "vitest/config";

/* Every test stands beside what it tests — a part's in the part, a step's in
   the step — so there is no tests folder to point at. What separates the two
   kinds is what they need: a `.test.js` runs on nothing but Node, and a
   `.spec.js` needs a browser and a dev server, which is Playwright's business
   and would only fail confusingly here. */
export default defineConfig({
  resolve: {
    /* The bare name a workflow from another repository imports the framework
       by, resolved here as `vite.config.js` resolves it for the page, so the
       framework's fixture workflow is tested as it is written. */
    alias: [{
      find: /^zmart-interface\//,
      replacement: `${path.join(import.meta.dirname, "zmart_interface")}/`,
    }],
  },
  test: {
    include: ["zmart_interface/**/*.test.js"],
    environment: "node",
  },
});
