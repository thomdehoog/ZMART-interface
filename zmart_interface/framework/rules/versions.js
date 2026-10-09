/**
 * Whether a version of the framework satisfies the range a workflow asks for.
 *
 * A workflow package says which framework it was written for, in its
 * `workflow.json`: `"framework": "^0.1.0"`, say. The page compares that with
 * its own version before it loads the bundle, and refuses one written for a
 * framework it is not, with a sentence rather than a page that half works.
 *
 * Pure, and small on purpose: the handful of range shapes a workflow author
 * actually writes, and nothing from a package. A version is `major.minor.patch`
 * with an optional tag after a hyphen (`0.1.0-rc.1`), and the tag is ignored
 * when comparing: a release candidate of 0.1.0 is 0.1.0 for the question
 * "was this workflow written for this framework".
 *
 * The ranges understood, each as a word to the reader:
 *
 * - `*` or an empty range: any version at all.
 * - `1.2.3`: exactly that version.
 * - `^1.2.3`: that version or newer, below the next major (below 2.0.0);
 *   while the major is 0, below the next minor (`^0.1.0` means 0.1.x), the
 *   way npm reads it, since a 0.x framework changes between minors.
 * - `~1.2.3`: that version or newer, below the next minor (below 1.3.0).
 * - `>=1.2.3`, `>1.2.3`, `<=1.2.3`, `<1.2.3`: one bound.
 * - Several of the above separated by spaces: all must hold (`>=0.1.0 <0.3.0`).
 */

/** The three numbers of a version, the tag dropped; null for something that is not one. */
export function parseVersion(text) {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\s*$/.exec(String(text ?? ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const compare = (a, b) => {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

/* One clause of a range, as a test of a parsed version. */
function clause(text) {
  const m = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(text);
  const op = m[1] ?? "=";
  const at = parseVersion(m[2]);
  if (!at) return null;
  switch (op) {
    case "=": return (v) => compare(v, at) === 0;
    case ">=": return (v) => compare(v, at) >= 0;
    case ">": return (v) => compare(v, at) > 0;
    case "<=": return (v) => compare(v, at) <= 0;
    case "<": return (v) => compare(v, at) < 0;
    case "~": return (v) => compare(v, at) >= 0 && compare(v, [at[0], at[1] + 1, 0]) < 0;
    case "^": {
      const ceiling = at[0] > 0 ? [at[0] + 1, 0, 0] : [0, at[1] + 1, 0];
      return (v) => compare(v, at) >= 0 && compare(v, ceiling) < 0;
    }
    default: return null;
  }
}

/**
 * Whether `version` lies in `range`. A range nobody can read is not
 * satisfied by anything, so a misspelt range refuses the workflow rather
 * than letting it in; a version nobody can read is satisfied by nothing
 * but `*`.
 */
export function satisfies(version, range) {
  const words = String(range ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || (words.length === 1 && words[0] === "*")) return true;
  const v = parseVersion(version);
  if (!v) return false;
  const tests = words.map(clause);
  if (tests.some((t) => t === null)) return false;
  return tests.every((t) => t(v));
}
