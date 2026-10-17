/**
 * The types of the agreement between the framework and a workflow: what a
 * workflow declares, and the page the framework hands each of its steps.
 *
 * Written here, beside the framework that implements them, and offered to
 * workflows by name through the workflow API (`../api/index.ts`), which is
 * the only door a workflow may use.
 *
 * Author: Thom de Hoog, Center for Microscopy and Image Analysis (ZMB),
 * University of Zurich (thom.dehoog@zmb.uzh.ch, thomdehoog@gmail.com).
 */

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

/** A workflow as the framework assembles it from its folder: named, its steps numbered. */
export interface AssembledWorkflow<W extends WorkflowTypes = Plain> {
  name: string;
  blurb: string;
  steps: Step<W>[];
  panels: Panel[];
  freshState?: Flow<W>["freshState"];
  keptAcrossSessions: string[];
  forTests?: Flow<W>["forTests"];
  install?: Flow<W>["install"];
  backendFor?: Flow<W>["backendFor"];
}

/* ---- the framework's own view: not offered to workflows ------------------------- */

/** The run document as the framework keeps it: its own keys, every one writable here, and the workflow's beside them. */
export type TheRun = { -readonly [K in keyof FrameworkRun]: FrameworkRun[K] } & Record<string, unknown>;

/** A step as the framework reads it: the API's step, of a workflow that adds nothing. */
export type FrameStep = Step<Plain>;

/**
 * A workflow's page as the framework builds it: what a step may call
 * (`Page`), and the framework's own parts beside it, which the frame's
 * modules call on each other.
 */
export interface FramePage {
  run: TheRun;
  backend: object;
  flow(): AssembledWorkflow;
  steps(): FrameStep[];
  step(index: number): FrameStep;
  indexOfStep(id: string): number;
  tabsForStep(index: number): string[];
  panels: Record<string, BuiltPanel>;
  shown: Record<string, unknown>;
  hooks: Hooks;
  /* the rail */
  renderRail(): void;
  readiness(step: FrameStep): string | null;
  stateEdited(id: string): void;
  resetRun(): void;
  /* the press */
  renderStepAction(shown?: string): void;
  renderActionBar(): void;
  /* the runner */
  runStep(index: number, options?: Record<string, unknown>): Promise<Outcome>;
  interruptWalk(): void;
  /* the tabs */
  focusPanelsFor(index: number): void;
  renderTabs(): void;
  shownPanel(): string | undefined;
  renderPanels(): void;
  renderAll(): void;
  /* the channel */
  activeStep(): FrameStep | null;
  actionSlot(): HTMLElement | null;
  renderSide(show?: string): void;
  remountChannel(): void;
}
