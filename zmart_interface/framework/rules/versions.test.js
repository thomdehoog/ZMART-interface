/* The version check a workflow package meets before the page loads it. */

import { describe, it, expect } from "vitest";
import { parseVersion, satisfies } from "./versions.js";

describe("reading a version", () => {
  it("reads the three numbers and drops the tag", () => {
    expect(parseVersion("0.1.0")).toEqual([0, 1, 0]);
    expect(parseVersion("0.1.0-rc.1")).toEqual([0, 1, 0]);
    expect(parseVersion("v2.10.3")).toEqual([2, 10, 3]);
  });

  it("refuses what is not a version", () => {
    expect(parseVersion("0.1")).toBeNull();
    expect(parseVersion("latest")).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
  });
});

describe("whether a framework satisfies a workflow's range", () => {
  it("takes anything for an empty range or a star", () => {
    expect(satisfies("0.1.0", "*")).toBe(true);
    expect(satisfies("0.1.0", "")).toBe(true);
    expect(satisfies("0.1.0", undefined)).toBe(true);
  });

  it("reads a caret the way npm does, with 0.x changing between minors", () => {
    expect(satisfies("0.1.0-rc.1", "^0.1.0")).toBe(true);
    expect(satisfies("0.1.4", "^0.1.0")).toBe(true);
    expect(satisfies("0.2.0", "^0.1.0")).toBe(false);
    expect(satisfies("1.4.0", "^1.2.3")).toBe(true);
    expect(satisfies("2.0.0", "^1.2.3")).toBe(false);
    expect(satisfies("1.2.2", "^1.2.3")).toBe(false);
  });

  it("reads a tilde as the same minor", () => {
    expect(satisfies("1.2.9", "~1.2.3")).toBe(true);
    expect(satisfies("1.3.0", "~1.2.3")).toBe(false);
  });

  it("reads bounds, alone and together", () => {
    expect(satisfies("0.2.0", ">=0.1.0")).toBe(true);
    expect(satisfies("0.0.9", ">=0.1.0")).toBe(false);
    expect(satisfies("0.2.0", ">=0.1.0 <0.3.0")).toBe(true);
    expect(satisfies("0.3.0", ">=0.1.0 <0.3.0")).toBe(false);
    expect(satisfies("0.1.0", "<=0.1.0")).toBe(true);
    expect(satisfies("0.1.0", "<0.1.0")).toBe(false);
    expect(satisfies("0.1.1", ">0.1.0")).toBe(true);
  });

  it("reads an exact version", () => {
    expect(satisfies("0.1.0-rc.1", "0.1.0")).toBe(true);
    expect(satisfies("0.1.1", "0.1.0")).toBe(false);
  });

  it("refuses a range nobody can read, and a version nobody can read", () => {
    expect(satisfies("0.1.0", "latest")).toBe(false);
    expect(satisfies("0.1.0", "^0.1")).toBe(false);
    expect(satisfies("development", "^0.1.0")).toBe(false);
  });
});
