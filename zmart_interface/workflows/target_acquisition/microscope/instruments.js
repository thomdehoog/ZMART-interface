/**
 * What can be connected to, and what this page calls it.
 *
 * The list comes from the bridge (`GET /api/instruments`) as names: the
 * interface's own mock microscope, `interface-mock`, then every driver
 * registered on this computer, by its name
 * (`zmart_controller.get_drivers()`, the controller's own mock, `mock`,
 * first). Connect sends the chosen name back. The page never invents an
 * instrument; it only puts friendlier words on the names it happens to know.
 */

/**
 * The interface's own pretend microscope, by the name the bridge offers it
 * under. The ZMART Controller has a pretend microscope of its own too (a
 * slide of beads, listed as `mock`), and an operator who chose "Mock" must
 * get this one.
 */
export const THE_MOCK = "interface-mock";

/** Whether a listed name is the interface's own mock. */
export const isTheMock = (name) => name === THE_MOCK;

/** Friendlier words for the names the page knows; any other is shown as it is. */
export const MICROSCOPES = {
  [THE_MOCK]: { label: "Mock", detail: "the interface's pretend microscope",
    api: "Mock API", apiDetail: "in-process · made-up data" },
  mock: { label: "Mock beads", detail: "the controller's pretend microscope",
    api: "Mock API", apiDetail: "in-process · made-up data" },
};

/**
 * The listed names, shaped the way the Connect card asks: one microscope per
 * name, each with the one driver it is plugged in through. List order is kept.
 */
export function choicesFrom(instruments) {
  return (instruments ?? []).map((name) => {
    const known = MICROSCOPES[name];
    return {
      key: name,
      label: known?.label ?? name,
      detail: known?.detail ?? "",
      apis: [{
        key: name, label: known?.api ?? "ZMART driver", detail: known?.apiDetail ?? "", instrument: name,
      }],
    };
  });
}

/**
 * Where the interface's own mock sits among the choices: the microscope's
 * key and the driver's, ready for the Connect card to select. `null` when it
 * is not listed.
 */
export function theMockAmong(choices) {
  const scope = (choices ?? []).find((one) => isTheMock(one.key));
  return scope ? { microscope: scope.key, api: scope.apis[0].key } : null;
}

export const DEFAULT_SESSION = {
  /* Chosen once the instruments are listed: the interface's mock when it is
     listed, so a page opened by accident drives nothing. */
  microscope: null,
  api: null,
  /* Empty on purpose. It used to be prefilled so the mock could be clicked
     through without typing, but the same page is the one a real instrument
     is driven from, and a default credential is not a convenience: it is a
     credential everybody has. Connect stays disabled until one is typed. */
  password: "",
};

export const describeSession = ({ instrument }) => {
  if (!instrument) return "not chosen";
  return MICROSCOPES[instrument]?.label ?? instrument;
};
