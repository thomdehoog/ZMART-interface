/**
 * Starting the interface's Python from a browser test.
 *
 * The browser tests that need a bridge, or a small server of their own, start
 * it in the Python the interface is installed in.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * The Python the bridge runs in: the one the interface is installed in.
 *
 * `PYTHON=` names it; otherwise it is whichever `python` is on the path. It
 * has to be the operator's own environment, with this package and its
 * dependencies installed: these tests were once green for a day while the
 * shipped window could not focus at all, because the harness ran the bridge
 * from an environment that had a package the operator's did not.
 */
export const pythonForTheBridge = () => process.env.PYTHON ?? "python";

/**
 * How the walks start that Python: the command, its arguments and the folder.
 *
 * `-P` keeps the folder Python starts in off its search path. The walks start
 * from the root of this repository, where a folder called `zmart_interface`
 * sits; without `-P` Python imports that folder in front of the installed
 * package, and the walk tests the clone instead of what an operator installs.
 * A developer with an editable install still gets their working copy, since
 * the installation itself points Python there.
 */
export const bridgePython = (...args: string[]) => ({
  command: pythonForTheBridge(), args: ["-P", ...args], cwd: REPO,
});
