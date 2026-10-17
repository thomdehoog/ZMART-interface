/**
 * The workflow API: what a workflow may use of the interface, and what it
 * declares for the interface to run it.
 *
 * A workflow imports its own files, this module, and the npm packages the
 * interface lists; nothing else (dependency-cruiser stops the build on
 * anything else). Every name here is part of the agreement, and so is when
 * the framework calls what a workflow declares (`docs/the-workflow-api.md`).
 * A change to either is a change of `API_VERSION`, which each workflow's
 * `workflow.json` names a range of.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

import version from "./version.json";

/** The version of this agreement (`version.json`). At 0.x every minor is a change a workflow must look at. */
export const API_VERSION: string = version.version;

/* ---- the helpers a step reaches for ----------------------------------------- */

export { el, css, sizeCanvas } from "../framework/window/dom.js";
export { sideGroup } from "../framework/window/panels.js";
export { status } from "../framework/window/status.js";
export { atBridge } from "../framework/window/bridge-address.js";
export { editedAt, staleSteps } from "../framework/rules/steps.js";

/** The page's base colours and measures, as CSS custom properties a workflow's styles and canvases read. */
export type ThemeVar =
  | "--bg" | "--screen" | "--surface-2" | "--surface-3" | "--control" | "--box-gap"
  | "--line" | "--line-strong" | "--ink" | "--ink-2" | "--ink-3"
  | "--accent" | "--accent-deep" | "--accent-tint" | "--accent-line"
  | "--good" | "--bad" | "--warn-bg" | "--warn-ink" | "--confirm-ink" | "--edit-ink" | "--warn-line"
  | "--shadow" | "--mono" | "--sans" | "--side-w" | "--head-h" | "--brand";

/* ---- the types a workflow fills in --------------------------------------------- */

/**
 * One bag a workflow fills in, so every type below speaks of its own:
 * `state` its keys of the run document, `backend` what its steps speak to,
 * `lends` what it lends its page, `shown` the boxes its steps put on screen,
 * and `step` any fields of its own its steps carry.
 */
export interface WorkflowTypes {
  state: object;
  backend: object;
  lends: object;
  shown: object;
  step: object;
}

/** A workflow that keeps, lends and adds nothing: the defaults. */
export interface Plain extends WorkflowTypes {
  state: Record<never, never>;
  backend: Record<never, never>;
  lends: Record<never, never>;
  shown: Record<string, unknown>;
  step: Record<never, never>;
}

/** The walk of the steps in turn: a step that walks the others sets `running`; the operator's Interrupt sets `interrupted`. */
export interface Walk {
  running: boolean;
  interrupted: boolean;
}

/**
 * The framework's keys of the run document. A workflow may write the
 * first group and only read the second: those are the runner's and the
 * page's own. The run document is plain data, with no functions and no
 * handles.
 */
export interface FrameworkRun {
  /** Which steps are done, by id. */
  done: Set<string>;
  /** Done, but made under settings that have since changed: orange in the rail. */
  stale: Set<string>;
  /** Which steps have actually been run, as against settled by standing. */
  ran: Set<string>;
  /** What each step came to, by id: the sentence beside its press. */
  notes: Record<string, string>;
  /** The step stood on, by its place in the list. */
  activeIdx: number;
  /** The walk of the steps in turn. */
  walk: Walk;
  /** Whether the channel is folded away to the right. */
  sideFolded: boolean;

  /** The workflow open, by folder. */
  readonly wf: string;
  /** The step running now, by id. */
  readonly running: string | null;
  /** The step being interrupted, by id. */
  readonly interrupting: string | null;
  /** The step whose last run failed, by id. */
  readonly failed: string | null;
  /** The panels the step stood on offers, and the one shown. */
  readonly tabs: string[];
  readonly tab: string | null;
  /** Which step's controls the channel holds now. */
  readonly sideMounted: string | null;
}

/** The run document: the framework's keys, and the workflow's own. */
export type Run<W extends WorkflowTypes = Plain> = FrameworkRun & W["state"];

/** What a step's run answers: nothing for a run that finished, the operator's stop with its sentence, or a failure already shown. */
export type RunAnswer = void | undefined | { stopped: true; note: string } | { failed: unknown };

/** How a press ended, as `runStep` answers it. */
export type Outcome =
  | { outcome: "finished" }
  | { outcome: "stopped" }
  | { outcome: "failed"; why: unknown }
  | { outcome: "busy" };

/** What a channel's mount hands back: where the step's press goes, and what to put away when the channel changes hands. */
export interface Mounted {
  actionSlot?: HTMLElement | null;
  destroy?: () => void;
}

/** A step's controls, in the column beside the panel. */
export interface Channel<W extends WorkflowTypes = Plain> {
  id: string;
  label: string;
  mount(host: HTMLElement, page: Page<W>, options: { locked: boolean }): Mounted | void;
  /** Mounted again on every render, rather than once per step. */
  rebuildsOnEveryRender?: boolean;
}

/** What a panel's build hands back, every field optional, beside whatever the workflow's steps need of it. */
export interface Built {
  /** The column a step's controls are mounted in. */
  channel?: HTMLElement;
  /** The draggable edge of that column. */
  divider?: HTMLElement;
  /** The press that puts the column away. */
  fold?: HTMLElement;
  /** Where a step's press goes when its controls have no slot of their own. */
  foot?: HTMLElement | null;
  /** Called when the panel comes on screen or its room changes. */
  shown?: () => void;
}

/** A panel a workflow puts on screen. */
export interface Panel {
  key: string;
  label: string;
  /** Once a step has asked for it, it stays for every step after. */
  stays?: boolean;
  build?(host: HTMLElement): Built & Record<string, unknown>;
}

/** A panel as built: the declaration, its box, and what its build handed back. */
export type BuiltPanel = Panel & Built & { host: HTMLElement } & Record<string, unknown>;

/** A step that walks the others: what its press does, and the sentence beside the walk's Interrupt. */
export interface Walks<W extends WorkflowTypes = Plain> {
  press(page: Page<W>): unknown;
  whileWalking?: string;
}

/** One step of a workflow. */
export type Step<W extends WorkflowTypes = Plain> = W["step"] & {
  id: string;
  title: string;
  /** Its number in the rail, when not its place in the list ("3a"). */
  n?: string;
  panels?: string[];
  btn?: string;
  /** The step's own controls build its press. */
  ownButton?: boolean;
  /** How long a step with no `run` takes. */
  ms?: number;
  mode?: string;
  run?(page: Page<W>, step: Step<W>, options: Record<string, unknown>): RunAnswer | Promise<RunAnswer>;
  finished?(page: Page<W>, step: Step<W>): void;
  brake?(page: Page<W>): unknown;
  again?: string;
  rerunCurrent?(page: Page<W>): (() => Record<string, unknown>) | null;
  walks?: Walks<W>;
  beside?(run: Run<W>, how: { done: boolean }): string | null | undefined;
  noHint?: boolean;
  afterThePress?(host: HTMLElement, page: Page<W>): void;
  channel?: Channel<W>;
  arrived?(page: Page<W>): void;
  settledByStanding?(page: Page<W>): void;
  ready?(run: Run<W>, page: Page<W>): string | null;
  nothingWaitsOnThis?: boolean;
};

/**
 * What a step may call of its page: the run, the backend, the panels and
 * the steps, the renders, and the framework's verbs -- plus what its
 * workflow lends.
 */
export type Page<W extends WorkflowTypes = Plain> = W["lends"] & {
  run: Run<W>;
  backend: W["backend"];
  panels: Record<string, BuiltPanel>;
  shown: W["shown"];
  steps(): Step<W>[];
  step(index: number): Step<W>;
  indexOfStep(id: string): number;
  activeStep(): Step<W> | null;
  /** Bring the whole page up to date: the rail, the press, the tabs, the panels, the channel. */
  renderAll(): void;
  renderRail(): void;
  renderActionBar(): void;
  /** The operator arrived at step `index`: its panels, and the step's own `arrived`. */
  focusPanelsFor(index: number): void;
  /** What the step still waits for, or null. */
  readiness(step: Step<W>): string | null;
  /** The operator edited step `id`: it is settled, and the done steps after it go orange. */
  stateEdited(id: string): void;
  runStep(index: number, options?: Record<string, unknown>): Promise<Outcome>;
  /** Start the run over, keeping what the workflow keeps across sessions. */
  resetRun(): void;
  /** Mount the step's controls afresh at the next render. */
  remountChannel(): void;
  /** The operator's Interrupt of a walk. */
  interruptWalk(): void;
  /** The panel on screen, by key. */
  shownPanel(): string | undefined;
};

/** What the framework calls back into the open workflow. */
export interface Hooks<W extends WorkflowTypes = Plain> {
  onRender?(): void;
  onPanelShown?(step: Step<W>, key: string): void;
  onReset?(): void;
  onLeave?(): void;
  onChannelMounted?(host: HTMLElement, channel: Channel<W>): void;
}

/** What `install` answers. */
export interface Installed<W extends WorkflowTypes = Plain> {
  lends?: W["lends"];
  hooks?: Hooks<W>;
}

/** A workflow, as its `flow` declares it. */
export interface Flow<W extends WorkflowTypes = Plain> {
  steps: Step<W>[];
  blurb: string;
  name?: string;
  panels?: Panel[];
  opensFirst?: boolean;
  install?(page: Page<W>): Installed<W> | void;
  backendFor?(search: URLSearchParams): W["backend"];
  freshState?(made: { backend: W["backend"] }): W["state"];
  keptAcrossSessions?: string[];
  forTests?(run: Run<W>): Record<string, unknown>;
}
