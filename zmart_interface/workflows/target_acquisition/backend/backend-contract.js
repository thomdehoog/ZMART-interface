/**
 * Target acquisition's promises: what its own verbs must do, asked of the
 * pretend backend and the live one alike, as `parts/microscope/backend-contract.js`
 * does for the verbs every workflow shares.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import { across, spanOf, theTravelOf } from "../../../parts/microscope/backend-contract.js";

export function promisesOfTargetAcquisition(expect) {
  return [
    {
      what: "measures a focus point and reports a height for it",
      async keep(backend) {
        const travel = await theTravelOf(backend);
        const { points } = await backend.measureFocus(
          [across(travel, 0.25, 0.3)],
          { metric: "brenner", extent: spanOf(travel) },
        );
        expect(points.length, "one point asked for, one back").toBe(1);
        const [point] = points;
        /* A height, or a plain admission that there is none. What is not
           allowed is a made-up number: the page fits a surface through these,
           so one invented zero drags the whole map somewhere nobody looked. */
        if (point.z === null) {
          expect(point.lost, "a point with no height says so").toBe(true);
        } else {
          expect(Number.isFinite(point.z), "the height is a number").toBe(true);
          expect(point.zAuto, "and the instrument's own answer is kept").toBe(point.z);
        }
      },
    },
    {
      what: "keeps every point it was asked about, in the order asked",
      async keep(backend) {
        const travel = await theTravelOf(backend);
        const asked = [
          across(travel, 0.1, 0.15),
          across(travel, 0.4, 0.4),
          across(travel, 0.75, 0.75),
        ];
        const { points } = await backend.measureFocus(asked, {
          metric: "brenner", extent: spanOf(travel),
        });
        expect(points.map((p) => [p.x, p.y])).toEqual(asked.map((p) => [p.x, p.y]));
      },
    },
    {
      what: "asks where each search begins only once the point before it has landed",
      async keep(backend) {
        /* The page starts each point's stack at the height just found at the
           point before, so it has to be asked after that point is reported,
           never all at once up front. */
        const travel = await theTravelOf(backend);
        const asked = [across(travel, 0.2, 0.2), across(travel, 0.3, 0.3), across(travel, 0.4, 0.4)];
        const happened = [];
        await backend.measureFocus(asked, {
          metric: "brenner", extent: spanOf(travel),
          beginAt: (index) => { happened.push(`begin ${index}`); return undefined; },
          onPoint: (_, index) => happened.push(`landed ${index}`),
        });
        expect(happened).toEqual([
          "begin 0", "landed 0", "begin 1", "landed 1", "begin 2", "landed 2",
        ]);
      },
    },
    {
      what: "says where it stood as a scan goes",
      async keep(backend) {
        /* The mark on the canvas follows these answers. The watch's own poll
           is seconds behind a stage that moves on every field, so a scan the
           operator is watching had a mark that trailed the run -- the
           positions are in every progress answer already, and saying them is
           the backend's job because only its records know where it stood. */
        const travel = await theTravelOf(backend);
        const positions = [across(travel, 0.4, 0.4), across(travel, 0.6, 0.6)];
        const stood = [];
        await backend.scanOverview({
          positions, ms: 200,
          onProgress: (done, of, at) => { if (at) stood.push(at); },
        });
        expect(stood.length, "progress says where it stood").toBeGreaterThan(0);
        const last = stood[stood.length - 1];
        expect(last.x, "x is the last field's").toBeCloseTo(positions[1].x, 0);
        expect(last.y, "y is the last field's").toBeCloseTo(positions[1].y, 0);
      },
    },
  ];
}
