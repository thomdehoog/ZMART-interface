/**
 * The Connect card's lists come from the bridge (`/api/target_acquisition/instruments`) as
 * names: the interface's own mock, then the drivers registered on this
 * computer. `choicesFrom` shapes them the way the card asks, and keeps the
 * name under each, because the name is what Connect sends.
 */

import { describe, expect, it } from "vitest";
import {
  THE_MOCK, choicesFrom, describeSession, isTheMock, theMockAmong,
} from "./instruments.ts";
import { pretendInstruments } from "../backend/pretend.ts";

describe("choicesFrom", () => {
  it("offers one microscope per listed name, in list order", () => {
    const choices = choicesFrom([THE_MOCK, "beads", "stellaris"]);
    expect(choices.map((m) => m.key)).toEqual([THE_MOCK, "beads", "stellaris"]);
    expect(choices.map((m) => m.apis[0].instrument)).toEqual([THE_MOCK, "beads", "stellaris"]);
  });

  it("uses the page's words for names it knows, and the name itself otherwise", () => {
    const [mock, leica] = choicesFrom(pretendInstruments());
    expect(mock.label).toBe("Mock");
    expect(mock.apis[0].label).toBe("Mock API");
    expect(leica.label).toBe("stellaris");
    expect(leica.apis[0].label).toBe("ZMART driver");
  });

  it("finds the interface's own mock wherever it is listed, and only it", () => {
    expect(theMockAmong(choicesFrom(["stellaris", THE_MOCK]))).toEqual({ microscope: THE_MOCK, api: THE_MOCK });
    expect(theMockAmong(choicesFrom(["stellaris"]))).toBeNull();
    expect(isTheMock(THE_MOCK)).toBe(true);
    expect(isTheMock("stellaris")).toBe(false);
  });

  it("describes a session by its name", () => {
    expect(describeSession({ instrument: THE_MOCK })).toBe("Mock");
    expect(describeSession({ instrument: "stellaris" })).toBe("stellaris");
    expect(describeSession({ instrument: null })).toBe("not chosen");
  });
});
