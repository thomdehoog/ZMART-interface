/**
 * The workflow API's declaration report: what a workflow may use, as the type
 * checker declares it, written down and held to the API's version.
 *
 * A workflow is written against `zmart_interface/api/index.ts`. A change to any
 * name it offers -- a helper's arguments, a field of a step, a hook -- changes
 * the agreement, and a workflow written for the old one may stop fitting. So the
 * declarations of everything the API offers are kept in
 * `zmart_interface/api/report.txt`, under the version they belong to:
 *
 *     node tools/the-api-report.mjs --check    the declarations still match the report
 *     node tools/the-api-report.mjs --write    write the report again
 *
 * `--write` refuses to change the report under the version it already names:
 * changing what the API declares means raising `api/version.json` first (minor
 * for an addition, major for anything a workflow could trip over; see
 * `docs/the-workflow-api.md`). `--check` runs in CI, so a change to the API that
 * forgot its version stops there with a sentence saying so.
 *
 * Only what the API offers is in the report, and only its declarations: a
 * helper's body, a comment or another export of the same framework module may
 * change freely.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(import.meta.dirname, "..");
const API = path.join(ROOT, "zmart_interface/api/index.ts");
const VERSION = path.join(ROOT, "zmart_interface/api/version.json");
export const REPORT = path.join(ROOT, "zmart_interface/api/report.txt");

/** The declaration files the type checker writes for the API and what it reaches, by source path. */
function emittedDeclarations() {
  const { config } = ts.readConfigFile(path.join(ROOT, "tsconfig.json"), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, ROOT);
  const out = path.join(ROOT, ".declarations");
  const emitting = {
    ...options, noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: ROOT, outDir: out,
  };
  const host = ts.createCompilerHost(emitting);
  const written = new Map();
  host.writeFile = (name, text) => {
    const source = path.join(ROOT, path.relative(out, name)).replace(/\.d\.ts$/, ".ts");
    written.set(path.normalize(source), text);
  };
  const program = ts.createProgram([API], emitting, host);
  const problems = ts.getPreEmitDiagnostics(program);
  if (problems.length) {
    throw new Error(`the API does not type-check, so it has no report:\n${
      ts.formatDiagnostics(problems, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => ROOT, getNewLine: () => "\n" })}`);
  }
  program.emit();
  return written;
}

/* Declarations printed without their comments: a comment is not the agreement. */
const printer = ts.createPrinter({ removeComments: true });

/** The top-level declarations of one declaration file, by the name each declares. */
function declarationsIn(text) {
  const file = ts.createSourceFile("x.d.ts", text, ts.ScriptTarget.Latest, true);
  const print = (node) => printer.printNode(ts.EmitHint.Unspecified, node, file);
  const byName = new Map();
  for (const statement of file.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const one of statement.declarationList.declarations) byName.set(one.name.getText(file), print(statement));
    } else if (statement.name) {
      byName.set(statement.name.getText(file), print(statement));
    }
  }
  return { file, byName, print };
}

/** The report as the API stands now: each name the API offers, with its declaration, in the API's own order. */
export function theReport() {
  const version = JSON.parse(fs.readFileSync(VERSION, "utf8")).version;
  const written = emittedDeclarations();
  const index = declarationsIn(written.get(path.normalize(API)));
  const lines = [
    `// The workflow API ${version}: what a workflow may use, as the type checker declares it.`,
    "// Written by `node tools/the-api-report.mjs --write`; held to the version by `--check`.",
    "",
  ];
  for (const statement of index.file.statements) {
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const from = statement.moduleSpecifier.text;
      const source = path.normalize(path.resolve(path.dirname(API), from));
      const module = declarationsIn(written.get(source) ?? "");
      lines.push(`// ---- from ${from}`);
      for (const name of statement.exportClause.elements.map((one) => (one.propertyName ?? one.name).text)) {
        const declared = module.byName.get(name);
        if (!declared) throw new Error(`the API offers ${name} from ${from}, which declares no such name`);
        lines.push(declared, "");
      }
    } else if (!ts.isImportDeclaration(statement)) {
      lines.push(index.print(statement), "");
    }
  }
  return { version, text: `${lines.join("\n").trimEnd()}\n` };
}

/** The version a report was written under, read off its first line. */
const versionOf = (report) => /^\/\/ The workflow API (\S+):/.exec(report)?.[1] ?? null;

function main(argument) {
  const now = theReport();
  const kept = fs.existsSync(REPORT) ? fs.readFileSync(REPORT, "utf8") : "";
  if (argument === "--check") {
    if (kept === now.text) return 0;
    console.error(versionOf(kept) === now.version
      ? `The workflow API changed but its version did not. Raise zmart_interface/api/version.json `
        + `(now ${now.version}), then run \`node tools/the-api-report.mjs --write\`.`
      : `zmart_interface/api/report.txt is not the report of the API ${now.version}; `
        + "run `node tools/the-api-report.mjs --write`.");
    return 1;
  }
  if (argument === "--write") {
    if (kept && kept !== now.text && versionOf(kept) === now.version) {
      console.error(`The workflow API changed under the version the report already names (${now.version}). `
        + "Raise zmart_interface/api/version.json first.");
      return 1;
    }
    fs.writeFileSync(REPORT, now.text);
    console.log(`wrote ${path.relative(ROOT, REPORT)} for the workflow API ${now.version}`);
    return 0;
  }
  console.error("say --check or --write");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exitCode = main(process.argv[2]);
}
