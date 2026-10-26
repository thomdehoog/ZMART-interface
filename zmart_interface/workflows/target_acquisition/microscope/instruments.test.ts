/**
 * The Connect card's lists come from the bridge (`/api/target_acquisition/instruments`):
 * the interface's own mock, then the drivers registered on this computer,
 * each by its name with the settings of its connection the card shows.
 * `choicesFrom` shapes them the way the card asks, and keeps the name under
 * each, because the name is what Connect sends.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSION, THE_MOCK, choicesFrom, describeSession, isTheMock, takeTheSavedSettings, theMockAmong,
  type ListedInstrument,
} from "./instruments.ts";
import { pretendInstruments } from "../backend/pretend.ts";

/** Listed by name, with no settings of the card's named. */
const named = (...names: string[]): ListedInstrument[] => names.map((name) => ({ name, settings: {} }));

describe("choicesFrom", () => {
  it("offers one microscope per listed name, in list order", () => {
    const choices = choicesFrom(named(THE_MOCK, "beads", "stellaris"));
    expect(choices.map((m) => m.key)).toEqual([THE_MOCK, "beads", "stellaris"]);
    expect(choices.map((m) => m.apis[0].instrument)).toEqual([THE_MOCK, "beads", "stellaris"]);
  });

  it("uses the page's words for names it knows, and the name itself otherwise", () => {
    const [mock, leica] = choicesFrom(pretendInstruments());
    expect(mock.label).toBe("Mock");
    expect(mock.apis[0].label).toBe("Mock API");
    expect(leica.label).toBe("stellaris");
    /* Not known to the page: its connection's own words say what it is. */
    expect(leica.detail).toBe("stellaris-y42h93");
    expect(leica.apis[0].label).toBe("LAS X CAM API - Navigator Expert");
  });

  it("names the API by the driver's name when its connection gives none", () => {
    const [scope] = choicesFrom(named("beads"));
    expect(scope.apis[0].label).toBe("beads");
    expect(scope.detail).toBe("");
  });

  it("names the API by the driver's api_type when its connection gives one", () => {
    const [scope] = choicesFrom([{ name: "stellaris", settings: { api_type: "Navigator Expert" } }]);
    expect(scope.apis[0].label).toBe("Navigator Expert");
  });

  it("keeps the settings each driver's connection names, as the bridge gave them", () => {
    const settings = { host: "10.0.0.5", password: null, config: null };
    const [scope] = choicesFrom([{ name: "stellaris", settings }]);
    expect(scope.settings).toEqual(settings);
  });

  it("finds the interface's own mock wherever it is listed, and only it", () => {
    expect(theMockAmong(choicesFrom(named("stellaris", THE_MOCK)))).toEqual({ microscope: THE_MOCK, api: THE_MOCK });
    expect(theMockAmong(choicesFrom(named("stellaris")))).toBeNull();
    expect(isTheMock(THE_MOCK)).toBe(true);
    expect(isTheMock("stellaris")).toBe(false);
  });

  it("describes a session by its name", () => {
    expect(describeSession({ instrument: THE_MOCK })).toBe("Mock");
    expect(describeSession({ instrument: "stellaris" })).toBe("stellaris");
    expect(describeSession({ instrument: null })).toBe("not chosen");
  });
});

describe("takeTheSavedSettings", () => {
  it("fills the host, the client and the config with what the chosen driver saved", () => {
    const session = { ...DEFAULT_SESSION, host: "typed before", client: "typed before", config: "typed before" };
    const [scope] = choicesFrom([{ name: "stellaris", settings: {
      host: "10.0.0.5", client: "PythonClient", config: "C:/scope/setup.xml",
    } }]);
    takeTheSavedSettings(session, scope);
    expect(session.host).toBe("10.0.0.5");
    expect(session.client).toBe("PythonClient");
    expect(session.config).toBe("C:/scope/setup.xml");
  });

  it("leaves them empty where the driver saved no value, or names no such setting", () => {
    const session = { ...DEFAULT_SESSION, host: "typed before", client: "typed before", config: "typed before" };
    const [scope] = choicesFrom([{ name: "stellaris", settings: { host: null } }]);
    takeTheSavedSettings(session, scope);
    expect(session.host).toBe("");
    expect(session.client).toBe("");
    expect(session.config).toBe("");
  });

  it("never touches the password or the output folder", () => {
    const session = { ...DEFAULT_SESSION, password: "hunter2", outputRoot: "D:/runs" };
    takeTheSavedSettings(session, choicesFrom([{ name: "stellaris", settings: { password: null } }])[0]);
    expect(session.password).toBe("hunter2");
    expect(session.outputRoot).toBe("D:/runs");
  });
});
