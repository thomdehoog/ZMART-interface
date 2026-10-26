/**
 * What can be connected to, and what this page calls it.
 *
 * The list comes from the bridge (`GET /api/instruments`): the interface's
 * own mock microscope, `interface-mock`, then every driver registered on
 * this computer, by its name (`zmart_controller.get_instruments()`), each
 * with the settings of its connection the Connect card shows. Connect sends
 * the chosen name back, with what the operator typed. The page never invents
 * an instrument; it only puts friendlier words on the names it happens to know.
 */

/** The interface's own pretend microscope, by the name the bridge offers it under. */
export const THE_MOCK = "interface-mock";

/** Whether a listed name is the interface's own mock. */
export const isTheMock = (name: string): boolean => name === THE_MOCK;

/** Friendlier words for the names the page knows; any other is shown as it is. */
/** What the Connect card says of a microscope and the driver it is reached through. */
export interface KnownMicroscope {
  label: string;
  detail: string;
  api: string;
  apiDetail: string;
}

export const MICROSCOPES: Record<string, KnownMicroscope> = {
  [THE_MOCK]: { label: "Mock", detail: "the interface's pretend microscope",
    api: "Mock API", apiDetail: "in-process · made-up data" },
};

/**
 * The settings of a driver's connection the Connect card shows: each one the
 * connection names, with the value it was saved with. A setting it does not
 * name is one the driver does not need. A password is only ever named.
 */
export interface DriverSettings {
  microscope?: string | null;
  api_type?: string | null;
  host?: string | null;
  client?: string | null;
  password?: null;
  config?: string | null;
}

/** A microscope as the bridge lists it: its name, and its driver's settings. */
export interface ListedInstrument {
  name: string;
  settings: DriverSettings;
}

/** One microscope on the Connect card, with the drivers it is reached through. */
export interface Choice {
  key: string;
  label: string;
  detail: string;
  apis: { key: string; label: string; detail: string; instrument: string }[];
  settings: DriverSettings;
}

/**
 * The listed microscopes, shaped the way the Connect card asks: one per
 * name, each with the one driver it is plugged in through, named by the API
 * its connection gives, else by the page's words or the driver's name. List
 * order is kept.
 */
export function choicesFrom(instruments: ListedInstrument[] | null | undefined): Choice[] {
  return (instruments ?? []).map(({ name, settings }) => {
    const known = MICROSCOPES[name];
    return {
      key: name,
      label: known?.label ?? name,
      detail: known?.detail ?? settings.microscope ?? "",
      apis: [{
        key: name, label: settings.api_type || known?.api || name, detail: known?.apiDetail ?? "", instrument: name,
      }],
      settings,
    };
  });
}

/**
 * Where the interface's own mock sits among the choices: the microscope's
 * key and the driver's, ready for the Connect card to select. `null` when it
 * is not listed.
 */
export function theMockAmong(choices: Choice[] | null | undefined): { microscope: string; api: string } | null {
  const scope = (choices ?? []).find((one) => isTheMock(one.key));
  return scope ? { microscope: scope.key, api: scope.apis[0].key } : null;
}

/** The session the Connect card is filling in. */
export interface Session {
  microscope: string | null;
  api: string | null;
  password: string;
  host: string;
  client: string;
  config: string;
  /** The folder the run is made under: the last one used, until the operator names another. */
  outputRoot: string;
  instrument?: string;
}

export const DEFAULT_SESSION: Session = {
  /* Chosen once the instruments are listed: the interface's mock when it is
     listed, so a page opened by accident drives nothing. */
  microscope: null,
  api: null,
  /* Empty on purpose. It used to be prefilled so the mock could be clicked
     through without typing, but the same page is the one a real instrument
     is driven from, and a default credential is not a convenience: it is a
     credential everybody has. Connect stays disabled until one is typed. */
  password: "",
  /* The chosen driver's, once a microscope is chosen (`takeTheSavedSettings`). */
  host: "",
  client: "",
  config: "",
  /* The bridge's, once the instruments are listed: where the last run went. */
  outputRoot: "",
};

/** Put the chosen driver's saved host, client and config in the session, for the operator to change. */
export function takeTheSavedSettings(session: Session, choice: Choice | undefined): void {
  session.host = choice?.settings.host ?? "";
  session.client = choice?.settings.client ?? "";
  session.config = choice?.settings.config ?? "";
}

export const describeSession = ({ instrument }: { instrument?: string | null }): string => {
  if (!instrument) return "not chosen";
  return MICROSCOPES[instrument]?.label ?? instrument;
};
