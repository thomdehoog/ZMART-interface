/**
 * Step 1's channel — the session: what to open, and what came back.
 *
 * Connecting is not one action but a handful of questions, and the operator
 * needs to see the answers: an autofocus that fails an hour into a run
 * because the storage path was never writable is a bad way to find out. So
 * the card is two boxes. The first is what the session is opened with — the
 * controller's seven connection words, the same for every microscope: the
 * microscope, its API, the host, the client, the password, the config and
 * the output folder — and it locks once the session is open, because
 * everything after this was read through it. The microscope and its API are
 * the driver's; the rest are typed, filled with what the driver saved, and a
 * driver leaves the ones it does not need. The
 * second box is what the driver said when it opened: one row per check its
 * `get_info` reports (whether the stage answers, which limits and
 * calibration it loaded, where images go), each waiting until its answer
 * arrives. How a microscope is set up -- its limits, its origin, its
 * calibration -- belongs to the driver's own setup: the card shows what the
 * driver says it stands on.
 *
 * The card reaches for nothing around it. What it shows and what it does
 * arrive in `ctx`; the handle it gives back is how a check's answer lands
 * in the row already on screen.
 */

import { sideGroup } from "../../../../api/index.ts";
import { isFailed } from "../../microscope/connection-status.ts";
import { takeTheSavedSettings, type Choice, type Session } from "../../microscope/instruments.ts";
import type { Check, ListedProtocol } from "../../shared/run-document.ts";

/** What the card shows and what it does, handed in by the Connect channel. */
export interface SessionCardContext {
  connected(): boolean;
  connecting(): boolean;
  session(): Session;
  instruments(): Choice[];
  checks(): Check[];
  chosenMicroscope(): Choice | undefined;
  chosenInstrument(): string | null;
  connect(): unknown;
  disconnect(): void;
  changed(): void;
  /** The protocols this machine has written, or null when the backend keeps none. */
  protocols: (() => ListedProtocol[]) | null;
  protocolChosen?(): string | null;
  protocolNote?(): string;
  chooseProtocol(id: string | null): void;
  chooseProtocolFromFile?(file: File): void;
}

/** The card's handle: how a check's answer lands in the row already on screen. */
export interface SessionCard {
  answer(k: number, result: string): void;
}

export function renderSessionCard(host: HTMLElement, ctx: SessionCardContext): SessionCard {
  const session = ctx.session();
  const connected = ctx.connected();
  const connecting = ctx.connecting();
  /* The first step is headed the way every other step is: the name above the
     box, the box holding the work. What the session was opened with is
     already in the fields and in the rail beside them, so a third copy in the
     corner was the panel talking about itself. */
  const { group, body: card } = sideGroup("Connect to the microscope");
  card.classList.add("session-card");
  if (connected) card.classList.add("done");

  {
    const locked = connected || connecting;
    const form = document.createElement("div");
    form.className = "session-form";

    const scope = document.createElement("label");
    scope.className = "field";
    scope.innerHTML = "<span>Microscope</span><select></select>";
    /* Each control below was written into its label the line before. */
    const scopeSel = scope.querySelector("select")!;
    for (const m of ctx.instruments()) {
      const o = document.createElement("option");
      o.value = m.key;
      o.textContent = m.detail ? `${m.label} · ${m.detail}` : m.label;
      scopeSel.append(o);
    }
    if (!ctx.instruments().length) {
      const o = document.createElement("option");
      o.value = ""; o.textContent = "no instruments listed";
      scopeSel.append(o);
    }
    scopeSel.value = session.microscope ?? "";
    scopeSel.disabled = locked || !ctx.instruments().length;
    scopeSel.addEventListener("change", () => {
      session.microscope = scopeSel.value;
      session.api = ctx.chosenMicroscope()?.apis[0]?.key ?? null;
      takeTheSavedSettings(session, ctx.chosenMicroscope());
      ctx.changed();
    });

    /* One API per microscope: the driver's, said rather than chosen. */
    const api = document.createElement("div");
    api.className = "field";
    api.innerHTML = "<span>API</span><span></span>";
    const chosenApi = ctx.chosenMicroscope()?.apis.find((a) => a.key === session.api);
    api.lastElementChild!.textContent = chosenApi?.detail ? `${chosenApi.label} · ${chosenApi.detail}` : chosenApi?.label ?? "";

    /* A field the operator types into. Typing must not rebuild the card:
       re-rendering destroys the very input being typed into, which drops
       focus after every keystroke. Only the session is touched. Every field
       can be typed into; one the driver's connection does not name is
       filled with nothing, and a driver leaves a word it does not need. */
    const named = ctx.chosenMicroscope()?.settings ?? {};
    const typed = (label: string, key: "host" | "client" | "password" | "config" | "outputRoot", needed: boolean) => {
      const row = document.createElement("label");
      row.className = "field";
      row.innerHTML = key === "password"
        ? '<span></span><input type="password" autocomplete="current-password">'
        : '<span></span><input type="text">';
      row.querySelector("span")!.textContent = label;
      const input = row.querySelector("input")!;
      input.value = session[key];
      if (!needed) input.placeholder = "not used by this driver";
      input.disabled = locked;
      input.addEventListener("input", () => {
        session[key] = input.value;
      });
      return row;
    };

    form.append(
      scope, api,
      typed("Host", "host", "host" in named),
      typed("Client", "client", "client" in named),
      typed("Password", "password", "password" in named),
      typed("Config", "config", "config" in named),
      typed("Output folder", "outputRoot", true),
    );

    /* The protocol to open on: a new one, or one a finished run wrote on
       this machine. The list is the
       machine's, known only through the session, so the row says so until
       the session is open and then fills -- and stays live while the rows
       above it lock, since choosing is applying every step's settings. */
    if (ctx.protocols) {
      const listed = ctx.protocols();
      const chosen = ctx.protocolChosen?.() ?? null;
      const row = document.createElement("label");
      row.className = "field";
      row.innerHTML = "<span>Protocol</span><select></select>";
      const pick = row.querySelector("select")!;
      pick.id = "protocol-pick";
      const when = (seconds: number | undefined) => new Date(Number(seconds) * 1000)
        .toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
      const fresh = document.createElement("option");
      fresh.value = "";
      fresh.textContent = listed.length ? "New protocol" : "New protocol — none written on this machine yet";
      pick.append(fresh);
      /* The most recent few, saved ones by name and runs by their time;
         the chosen one stays listed however old; and a file of the
         operator's own, picked through the system's dialog. */
      const recent = listed.slice(0, 8);
      if (chosen && !recent.some((one) => one.id === chosen)) {
        const held = listed.find((one) => one.id === chosen);
        if (held) recent.push(held);
      }
      for (const one of recent) {
        const o = document.createElement("option");
        o.value = one.id;
        o.textContent = one.saved || one.fromFile ? `${one.id} · ${when(one.written)}` : `run · ${when(one.written)} · ${one.id.slice(-6)}`;
        pick.append(o);
      }
      const fromFile = document.createElement("option");
      fromFile.value = "__file__";
      fromFile.textContent = "Load from file…";
      pick.append(fromFile);
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = ".json,application/json";
      fileInput.id = "protocol-file";
      fileInput.hidden = true;
      fileInput.addEventListener("change", () => {
        const file = fileInput.files?.[0];
        if (file) ctx.chooseProtocolFromFile?.(file);
        pick.value = chosen ?? "";
      });
      pick.value = chosen ?? "";
      /* Chosen before the session opens and locked with the rest of the
         row once it has: a run is opened on one protocol. */
      pick.disabled = locked;
      pick.addEventListener("change", () => {
        if (pick.value === "__file__") { fileInput.click(); return; }
        ctx.chooseProtocol(pick.value || null);
      });
      form.append(row, fileInput);
      const note = document.createElement("p");
      note.className = "setup-note";
      note.id = "protocol-note";
      note.textContent = ctx.protocolNote?.() ?? "";
      note.hidden = !note.textContent;
      form.append(note);
    }
    card.append(form);
  }

  /* What the session was opened with is one thing; what came back when it
     was opened is another, so the answers stand in a box of their own under
     it. Every check is listed the moment the session is opened and each one
     ticks as its answer comes back — the row is the question, the mark is the
     answer. An open session is not editable, so the fields above stay on show
     as the record of what it was opened with. */
  let checks = null;
  const rows: HTMLDivElement[] = [];
  if (ctx.checks().length) {
    const made = sideGroup("Connection checks");
    checks = made.body;
    /* Beside the session's box, not inside it: two boxes standing in the
       channel, the way every other step's boxes stand. */
    host.append(made.group);
    const list = document.createElement("div");
    list.className = "check-list";
    for (const c of ctx.checks()) {
      const answered = c.result !== null;
      const failed = answered && isFailed(c.result);
      const row = document.createElement("div");
      row.className = "check-row" + (answered ? "" : " pending") + (failed ? " failed" : "");
      row.innerHTML = '<span class="check-mark"></span><span class="check-name"></span>'
        + '<span class="check-value"></span>';
      /* The three spans were written into the row just above. */
      row.querySelector(".check-mark")!.textContent = failed ? "✗" : "✓";
      row.querySelector(".check-name")!.textContent = c.label;
      row.querySelector(".check-value")!.textContent = answered ? c.result : "";
      rows.push(row);
      list.append(row);
    }
    checks.append(list);
  }

  /* The button sits at the end of the card, after everything it acts on —
     the rule every other step already follows. Once the session is open the
     press has nothing left to do, so what stands in its place is not a button
     at all: a green lamp and the word for it, the way an instrument says it is
     on. The way back out is the button, beside it. */
  {
    const foot = document.createElement("div");
    foot.className = "session-foot";
    const row = document.createElement("div");
    row.className = "session-buttons";

    if (connected) {
      const held = document.createElement("div");
      held.className = "session-state";
      held.innerHTML = '<i class="lamp"></i>';
      held.append("Connected");

      const out = document.createElement("button");
      out.type = "button";
      out.className = "danger";
      out.textContent = "Disconnect";
      out.addEventListener("click", () => ctx.disconnect());
      row.append(held, out);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "run";
      btn.textContent = connecting ? "connecting…" : "Connect";
      /* The password is the instrument's business, not the page's: the
         field starts empty and stays optional, and an instrument that wants
         one says so when the session is opened. The page once refused to
         connect without one, which only stood in the way of the mock. */
      btn.disabled = connecting || !ctx.chosenInstrument();
      btn.addEventListener("click", () => ctx.connect());
      row.append(btn);
      /* The way out is there from the moment a connect begins, not once it
         has finished: a connect that hangs on a check is exactly when an
         operator needs it, and there was nothing to press. */
      if (connecting) {
        const out = document.createElement("button");
        out.type = "button";
        out.className = "danger";
        out.textContent = "Disconnect";
        out.addEventListener("click", () => ctx.disconnect());
        row.append(out);
      }
    }

    foot.append(row);
    card.append(foot);
  }

  host.prepend(group);

  /* Only the answer lands. The row is already on screen, so filling one in
     touches that row rather than rebuilding the card under the operator —
     which would restart every other row's arrival along with it. */
  return {
    answer(k: number, result: string) {
      const row = rows[k];
      if (!row) return;
      row.classList.remove("pending");
      row.classList.toggle("failed", isFailed(result));
      row.querySelector(".check-mark")!.textContent = isFailed(result) ? "✗" : "✓";
      row.querySelector(".check-value")!.textContent = result;
    },
  };
}
