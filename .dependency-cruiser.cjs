/**
 * Which part of the page may import which, as dependency-cruiser checks it.
 *
 * The three layers have a direction: a workflow uses the parts and the
 * framework; the parts use the framework's base pieces; the framework uses no
 * workflow. Workflows share nothing with each other. Nothing goes round in a
 * circle. `npm run check:imports` says, file and line, where an import breaks
 * one of these.
 */
module.exports = {
  forbidden: [
    {
      name: "no-circle",
      comment: "Two modules that import each other, however far round, cannot be understood or moved one at a time.",
      severity: "warn",
      from: {},
      to: { circular: true },
    },
    {
      name: "framework-knows-no-workflow",
      comment: "The framework runs any workflow and knows none.",
      severity: "error",
      from: { path: "^zmart_interface/framework/" },
      to: { path: "^zmart_interface/workflows/" },
    },
    {
      name: "parts-know-no-workflow",
      comment: "A part is a general piece any workflow may use; nothing in it belongs to one workflow.",
      severity: "error",
      from: { path: "^zmart_interface/parts/" },
      to: { path: "^zmart_interface/workflows/" },
    },
    {
      name: "workflows-share-nothing",
      comment: "A piece two workflows need is general, and moves into parts/.",
      severity: "error",
      from: { path: "^zmart_interface/workflows/([^/]+)/" },
      to: { path: "^zmart_interface/workflows/", pathNot: "^zmart_interface/workflows/$1/" },
    },
    {
      name: "resolvable",
      comment: "An import that leads nowhere fails in the build; say so before it does. The viewer's drawing files are found by the build itself, in the installed viewer (tools/the-installed-viewer.mjs).",
      severity: "error",
      from: {},
      to: { couldNotResolve: true, pathNot: "^zmart-viewer/drawing/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "^zmart_interface/build/" },
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".js", ".mjs", ".ts", ".d.ts"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
