// The atlas page of the right panel: a view switch (session, repo, all), then Doing, Next
// and Done (20 a page) with group tags, and in the session view its docs. The session
// view holds only the session's todos, most relevant first, faded past a day; the others
// add a line that leads back to it. Reads shared "atlas", "atlas.mine" and "atlas.docs"
// (atlas-chip loads them). At most 50 rows: 8 doing, 12 next, 20 done, 10 docs.
// A fourth view, timeline, shows the session's effort from the Atlas timeline; only this panel has it.
// Keys and mouse actions: atlas/repos/herdr/herdr-app/atlas-mod/design.html#actions.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, HoverCard } from "gpui-base";
import { theme, shared, setShared, run, hc, agents, nextCommand } from "herdr";
import { updateTodo, moveTodo, addTodo, repoRef, PERSONAL, ago, openDoc, actingFor, setScope, SCOPES, sessionSummary, todoDetail, openTodo, effortFor, openTimeline, cut } from "./api.js";

const PAGE = 20;
const OTHER = "no group";
// A timeline entry's days, "12 Nov" or "12 to 13 Nov", read from the dates as the server wrote them.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso) => ({ d: Number(iso.slice(8, 10)), m: MONTHS[Number(iso.slice(5, 7)) - 1] });
const days = (e) => {
  if (!e.started_at) return "";
  const a = day(e.started_at), b = day(e.ended_at ?? e.started_at);
  return a.d === b.d && a.m === b.m ? `${a.d} ${a.m}` : `${a.d}${a.m === b.m ? "" : ` ${a.m}`} to ${b.d} ${b.m}`;
};
const message = (todo, extra) =>
  `Work on atlas todo #${todo.id}: ${todo.title}. Read it with \`atlas todo show ${todo.id}\`, run \`atlas todo start ${todo.id}\`, and \`atlas todo done ${todo.id}\` when finished.${extra ? `\n\n${extra}` : ""}`;

// What each action button does, by its glyph, with its key.
// The font draws ▸ and ⏎ smaller than ⊞ and ⊟, so they get more size to match.
const GLYPH = { "▸": 18, "⏎": 16 };
const SEND = "⌥ adds a message";
const TIPS = {
  "▸": "Start (s)", "✓": "Mark done (d)",
  "⏎": `Send to this agent (⏎) · ${SEND}`,
  "⊞": `Send to claude in a new pane (p) · ${SEND}`, "⊟": `Send to claude in a new tab (t) · ${SEND}`,
  link: "Open on the Atlas site",
  "↑": "Move up (⇧↑)",
  "↓": "Move down (⇧↓)",
  "⤒": "Move to the top (⇧t)",
  "⤓": "Move to the bottom (⇧b)",
};

const KEYS = [["⏎", "send"], ["p", "pane"], ["t", "tab"], ["⌥", "+ message"], ["⇧↑↓", "move"], ["⇧t", "top"], ["⇧b", "bottom"], ["a", "add"], ["r", "view"], ["f", "effort"], ["␣", "open"]];

export default class AtlasPanel extends View {
  init(_props, cx) {
    this.page = 0;
    this.busy = null;
    this.repo = null;
    this.sel = null; // "t<id>" or "d<stem>"
    this.note = null;
    this.compose = null; // { todo, where } for an extra message, or { add: true }
    this.drag = null; // { id, over, after }
    this.expanded = null; // { id, data, error } for the one open row
    this.mode = "todos"; // or "timeline"
    this.tl = null; // { key, at, loading, data, error }: the timeline view's effort
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "" });
    // atlas-panel.<action>: the same actions as the keys, for checks without a keyboard.
    // "focus" comes from pane.go (mod.json focusable).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        else this.act(cx, c, false);
        cx.notify();
      }
    });
  }

  say(cx, text) {
    this.note = text;
    cx.notify();
    cx.timer.after(3000, (cx) => { if (this.note === text) { this.note = null; cx.notify(); } });
  }

  refresh() { setShared("atlas.want", Date.now()); }

  status(cx, todo, status) {
    this.busy = todo.id;
    cx.notify();
    cx.spawn(async (cx) => {
      actingFor({ session: shared("atlas.docs")?.session, terminal: shared("atlas")?.terminal });
      await updateTodo(todo.id, { status }).catch(() => this.say(cx, "update failed"));
      this.busy = null;
      this.refresh();
      cx.notify();
    });
  }

  // To this agent (hc send queues behind a draft; Claude queues behind a turn),
  // a new pane beside it, or a new tab in its folder. New ones start claude.
  send(cx, todo, where, extra) {
    const s = shared("atlas");
    const text = message(todo, extra);
    const claude = ["zsh", "-lic", 'claude "$0"', text];
    if (where === "agent") {
      if (!s?.terminal) return this.say(cx, "no agent to send to");
      const busy = agents().find((a) => a.pane === s.pane)?.status === "working";
      hc(["send", s.terminal, text]).then((r) => this.say(cx, r.code ? "send failed" : `#${todo.id} ${busy ? "queued" : "sent"}`));
    } else if (where === "pane") {
      run("pane.split", { direction: "right", pane: s?.pane ?? undefined, argv: claude });
      this.say(cx, `#${todo.id} in a new pane`);
    } else {
      run("tab.new", { folder: s?.folder ?? undefined, argv: claude });
      this.say(cx, `#${todo.id} in a new tab`);
    }
  }

  // Next only: before or after a neighbour, taking its priority when it differs.
  // The list moves at once, so a second key press acts on the new order; the
  // refresh after the server answers confirms it (a fetch takes up to 3.8 s).
  move(cx, todo, body, label) {
    const s = shared("atlas");
    const lane = todo.status === "doing" ? "doing" : "next";
    const next = s.todos[lane].filter((x) => x.id !== todo.id);
    const moved = { ...todo, priority: "priority" in body ? body.priority : todo.priority };
    const at = body.top ? 0 : body.bottom ? next.length : next.findIndex((x) => x.id === (body.before ?? body.after)) + (body.after ? 1 : 0);
    next.splice(Math.max(0, at), 0, moved);
    setShared("atlas", { ...s, todos: { ...s.todos, [lane]: next } });
    this.busy = todo.id;
    cx.notify();
    cx.spawn(async (cx) => {
      let err = null;
      const it = await moveTodo(todo.id, body).then((r) => r?.item ?? r, (e) => { err = e?.message ?? "error"; });
      // The session view re-sorts atlas.mine by rank before the chip fetches it again, so
      // give it the new rank, or the row jumps back and then forward.
      const m = shared("atlas.mine");
      if (it?.rank && m) setShared("atlas.mine", { ...m, list: m.list.map((x) => x.id === todo.id ? { ...x, rank: it.rank, priority: it.priority ?? null } : x) });
      this.busy = null;
      this.say(cx, err ? `move failed: ${err}` : `#${todo.id} ${label}`);
      this.refresh();
    });
  }

  // The server orders each priority lane on its own, Inbox (null) included, so a todo
  // joins its neighbour's lane.
  nextTo(todo, other, side) {
    const body = { [side]: other.id };
    if ((other.priority ?? null) !== (todo.priority ?? null)) body.priority = other.priority ?? null;
    return body;
  }

  ask(cx, compose) {
    this.compose = compose;
    this.input = InputState.new({ placeholder: compose.add ? "New todo for Inbox" : `Extra message for #${compose.todo.id}` });
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.notify();
  }

  submit(cx) {
    const c = this.compose;
    const text = this.input.value().trim();
    this.compose = null;
    this.handle.focus();
    if (!c) return;
    if (c.add) this.add(cx, text);
    else this.send(cx, c.todo, c.where, text);
    cx.notify();
  }

  // Inbox: no priority. In the all view it goes to the personal list; in the session view,
  // to the repo of the todo in progress, if any.
  add(cx, title) {
    if (!title) return cx.notify();
    const s = shared("atlas");
    addTodo({ title, repo: s?.scope === "all" ? PERSONAL : s?.view === "session" && s.todos?.doing?.[0]?.repo ? s.todos.doing[0].repo : repoRef(s?.repo) })
      .then((t) => { this.say(cx, `added #${t?.id ?? ""}`); this.refresh(); }, () => this.say(cx, "add failed"));
  }

  // What the page lists: the view's todos; the session's docs in the session view, and a
  // one-line summary of the session in the others.
  // `efforts`: the todo groups in view with their counts, most first; `this.effort` narrows
  // the lists to one of them.
  lists() {
    const s = shared("atlas");
    const d = shared("atlas.docs");
    const session = s?.view === "session";
    const t = s?.applies ? s.todos : null;
    const counts = new Map();
    for (const x of t ? [...t.doing, ...t.next, ...t.done] : []) counts.set(x.group ?? OTHER, (counts.get(x.group ?? OTHER) ?? 0) + 1);
    const efforts = [...counts].sort((a, b) => b[1] - a[1]);
    if (this.effort && !counts.has(this.effort)) this.effort = null;
    const only = (list) => (this.effort ? list.filter((x) => (x.group ?? OTHER) === this.effort) : list);
    return {
      efforts,
      todos: t && (this.effort ? { ...t, doing: only(t.doing), next: only(t.next), done: only(t.done) } : t),
      docs: s?.applies && session && d ? d.list : [],
      summary: s?.applies && !session ? sessionSummary(shared("atlas.mine"), d, d?.key) : null,
    };
  }

  // The rows in screen order, for the keyboard.
  rows() {
    if (this.mode === "timeline") return [];
    const { docs, todos: t } = this.lists();
    const page = t ? Math.min(this.page, Math.max(0, Math.ceil(t.done.length / PAGE) - 1)) : 0;
    const todos = t ? [...t.doing.slice(0, this.cap("Doing", 8)), ...t.next.slice(0, this.cap("Next", 12)), ...t.done.slice(page * PAGE, page * PAGE + PAGE)] : [];
    return [...todos.map((todo) => ({ key: `t${todo.id}`, todo })), ...docs.slice(0, this.cap("Docs", 10)).map((doc) => ({ key: `d${doc.stem}`, doc }))];
  }

  // One action on the selected row. `alt` asks for an extra message first.
  act(cx, action, alt) {
    const s = shared("atlas");
    const rows = this.rows();
    let i = rows.findIndex((r) => r.key === this.sel);
    if (action === "down" || action === "up") {
      if (!rows.length) return;
      i = i < 0 ? 0 : (i + (action === "down" ? 1 : rows.length - 1)) % rows.length;
      this.sel = rows[i].key;
      return cx.notify();
    }
    if (action === "add") return this.ask(cx, { add: true });
    if (action.startsWith("add:")) return this.add(cx, action.slice(4));
    if (action === "effort") {
      const list = [null, ...this.lists().efforts.map(([g]) => g)];
      this.effort = list[(list.indexOf(this.effort) + 1) % list.length];
      this.page = 0;
      return cx.notify();
    }
    // "r" goes session, repo, all, timeline, then back to session.
    if (action === "scope") {
      if (!s?.applies) return;
      if (this.mode === "timeline") return this.pick(cx, SCOPES[0][0]);
      const i = SCOPES.findIndex(([k]) => k === s.scope);
      return i === SCOPES.length - 1 ? this.pick(cx, "timeline") : setScope(SCOPES[i + 1][0]);
    }
    if (action === "timeline" || SCOPES.some(([k]) => k === action)) return this.pick(cx, action);
    if (action.startsWith("select-")) { this.sel = `t${action.slice(7)}`; return cx.notify(); }
    if (action.startsWith("expand-")) return this.expand(cx, Number(action.slice(7)));
    const row = rows[i];
    if (!row) return;
    if (row.doc) { if (action === "agent") openDoc(row.doc.open); return; }
    const todo = row.todo;
    if (action === "expand") return this.expand(cx, todo.id);
    if (["agent", "pane", "tab"].includes(action)) return alt ? this.ask(cx, { todo, where: action }) : this.send(cx, todo, action);
    if (action === "start" && todo.status !== "doing") return this.status(cx, todo, "doing");
    if (action === "done" && todo.status !== "done") return this.status(cx, todo, "done");
    if (action.startsWith("move-")) this.shift(cx, todo, action);
  }

  // Up, down, top or bottom within the todo's own list, Doing or Next.
  shift(cx, todo, action) {
    if (todo.status === "done") return;
    const next = shared("atlas")?.todos?.[todo.status === "doing" ? "doing" : "next"] ?? [];
    const at = next.findIndex((x) => x.id === todo.id);
    const last = next[next.length - 1];
    const lane = (o) => (o.priority ?? null) !== (todo.priority ?? null) ? { priority: o.priority ?? null } : {};
    if (action === "move-up" && at > 0) this.move(cx, todo, this.nextTo(todo, next[at - 1], "before"), "moved up");
    if (action === "move-down" && at >= 0 && at < next.length - 1) this.move(cx, todo, this.nextTo(todo, next[at + 1], "after"), "moved down");
    if (action === "move-top" && at > 0) this.move(cx, todo, { top: true, ...lane(next[0]) }, "moved to the top");
    if (action === "move-bottom" && at >= 0 && at < next.length - 1) this.move(cx, todo, { bottom: true, ...lane(last) }, "moved to the bottom");
  }

  // Opening the timeline always reloads it; a todo view goes through atlas-chip's scope.
  pick(cx, k) {
    this.mode = k === "timeline" ? "timeline" : "todos";
    if (k === "timeline") this.tl = null;
    else setScope(k);
    cx.notify();
  }

  key(e, cx) {
    if (this.compose) {
      if (e.key === "escape") { this.compose = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const m = e.modifiers;
    if (m.platform || m.control) return;
    const action = m.shift
      ? { up: "move-up", down: "move-down", t: "move-top", b: "move-bottom" }[e.key]
      : { up: "up", down: "down", enter: "agent", p: "pane", t: "tab", s: "start", d: "done", a: "add", r: "scope", f: "effort", space: "expand" }[e.key];
    if (!action) return;
    cx.stop_propagation();
    this.act(cx, action, m.alt);
  }

  // One row open at a time. Its details load once, on open.
  expand(cx, id) {
    if (this.expanded?.id === id) { this.expanded = null; return cx.notify(); }
    const mine = { id, data: null, error: false };
    this.expanded = mine;
    this.sel = `t${id}`;
    cx.notify();
    cx.spawn(async (cx) => {
      try { mine.data = await todoDetail(id); } catch { mine.error = true; }
      cx.notify();
    });
  }

  // E3 in chip-options.html#expand-pick: under the wrapped title, the notes, sub-todos, the
  // last 3 changes one per row, where it lives, and labelled buttons, all from the title's edge.
  detail(t, todo) {
    const x = this.expanded;
    const box = v_flex().pr(12).pt(2).pb(8).gap(4).text_size(11.5).text_color(t.muted);
    const at = (el) => h_flex().gap(6).child(div().w(14).flex_none()).child(div().w(34).flex_none()).child(el.flex_1().min_w(0));
    if (!x.data) return box.child(at(div().text_color(t.dim).child(x.error ? "Couldn't load it." : "Loading…")));
    const it = x.data.item;
    const change = (e) => {
      const to = e.data?.status?.[1];
      const what = e.action === "create" ? "created" : to ? { doing: "started", done: "done", todo: "reopened" }[to] ?? to : e.data?.rank ? "moved" : "edited";
      return at(div().h(18).text_color(t.dim).child(`${what} · ${ago(e.at)} ago`));
    };
    const body = (it.body || "").trim();
    const kids = (x.data.children ?? []).slice(0, 10);
    const open = todo.status !== "done";
    const label = (id, text, fn, tip = TIPS[text[0]]) => this.tipped(t, id, div().id(id).flex_none().px(7).h(22).flex().items_center().rounded(5).border_1().border_color(t.border).bg(t.background)
      .text_size(11).text_color(t.foreground).cursor_pointer().hover((el) => el.border_color(t.accent))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); fn(cx, e.modifiers.alt); }).child(text), tip);
    return box
      .child(at(div().h(1).mb(4).bg(t.border)))
      .child(at(div().text_color(body ? t.foreground : t.dim).child(body ? body.slice(0, 1500) + (body.length > 1500 ? "…" : "") : "No notes.")))
      .when(kids.length > 0, (el) => el.child(at(v_flex().gap(2).children(kids.map((k) =>
        div().truncate().child(`${k.status === "doing" ? "○" : "●"} #${k.id} ${k.title}`))))))
      .child(v_flex().pt(2).children((x.data.events ?? []).slice(0, 3).map(change)))
      .child(at(h_flex().gap(12).flex_wrap().text_color(t.dim).children([["repo", it.repo_name ?? "personal"], ["effort", it.group_name ?? "no group"], ["user", it.created_by]]
        .filter(([, v]) => v).map(([icon, v]) => h_flex().gap(4).items_center()
          .child(svg(`mods/atlas-chip/${icon}.svg`).size(11).flex_none().text_color(t.muted)).child(v)))))
      .child(at(h_flex().pt(4).gap(6).flex_wrap()
        .when(todo.status === "todo", (el) => el.child(label(`apx-s-${todo.id}`, "▸ start", (cx) => this.status(cx, todo, "doing"))))
        .when(todo.status === "doing", (el) => el.child(label(`apx-d-${todo.id}`, "✓ done", (cx) => this.status(cx, todo, "done"))))
        .when(open, (el) => el
          .child(label(`apx-a-${todo.id}`, "⏎ send", (cx, alt) => alt ? this.ask(cx, { todo, where: "agent" }) : this.send(cx, todo, "agent")))
          .child(label(`apx-p-${todo.id}`, "⊞ pane", (cx, alt) => alt ? this.ask(cx, { todo, where: "pane" }) : this.send(cx, todo, "pane")))
          .child(label(`apx-t-${todo.id}`, "⊟ tab", (cx, alt) => alt ? this.ask(cx, { todo, where: "tab" }) : this.send(cx, todo, "tab"))))
        .child(label(`apx-o-${todo.id}`, svg("mods/atlas-chip/link.svg").size(11), () => openTodo(todo.id), TIPS.link))
        .when(open, (el) => el.child(div().w(1).h(14).mx(2).bg(t.border))
          .children([["u", "↑", "move-up"], ["w", "↓", "move-down"], ["k", "⤒", "move-top"], ["j", "⤓", "move-bottom"]]
            .map(([k, glyph, action]) => label(`apx-${k}-${todo.id}`, glyph, (cx) => this.shift(cx, todo, action)))))));
  }

  // What an action does, in a card beside it after 100 ms. herdr-app's own tooltip() has a
  // fixed, slower delay. Cost: atlas-mod/evidence/hint-cards.
  tipped(t, id, el, tip) {
    if (!tip) return el;
    return HoverCard.new(`${id}-tip`).flex_none().open_delay(100).close_delay(0).trigger(el)
      .content(div().px(8).py(4).rounded(5).bg(t.popover).border_1().border_color(t.border).text_size(11.5).text_color(t.foreground).child(tip));
  }

  button(t, id, label, fn) {
    return this.tipped(t, id, div().id(id).flex_none().w(24).h(22).flex().items_center().justify_center().rounded(5).text_size(GLYPH[label] ?? 14).text_color(t.dim)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); fn(cx, e.modifiers.alt); }).child(label), TIPS[label]);
  }

  // One timeline row: a dot on the line, #id, title, group, a time and actions.
  // Next rows drag: press on one, release on another to drop it there.
  row(t, todo, cx) {
    const color = { doing: t.foreground, todo: t.muted, done: t.accent }[todo.status];
    const when = todo.status === "doing" ? ago(todo.updated) : todo.status === "done" ? ago(todo.done) : todo.priority ?? "";
    const key = `t${todo.id}`;
    const selected = this.sel === key;
    const open = todo.status !== "done";
    const drop = this.drag && this.drag.over === todo.id && this.drag.id !== todo.id;
    const pick = (cx) => { this.sel = key; this.handle.focus(); cx.notify(); };
    const expanded = this.expanded?.id === todo.id;
    let el = (expanded ? h_flex().min_h(28).py(6).items_start() : h_flex().h(28).items_center()).id(`apn-${todo.id}`).pr(4).gap(6).rounded(6)
      .when(Boolean(todo.faded) && !expanded, (el) => el.opacity(0.5))
      .when(selected && !expanded, (el) => el.bg(t.hover)).when(!expanded, (el) => el.hover((el) => el.bg(t.hover)))
      .when(Boolean(drop), (el) => this.drag.after ? el.border_b_2().border_color(t.accent) : el.border_t_2().border_color(t.accent))
      .on_click((_e, cx) => pick(cx));
    if (todo.status === "todo") {
      el = el
        .on_mouse_down("left", (_e, cx) => { this.drag = { id: todo.id, over: null, after: false }; pick(cx); })
        .on_mouse_move((e, cx) => {
          if (!this.drag || this.drag.id === todo.id) return;
          const after = e.local_position ? e.local_position.y > 14 : false;
          if (this.drag.over !== todo.id || this.drag.after !== after) { this.drag = { ...this.drag, over: todo.id, after }; cx.notify(); }
        })
        .on_mouse_up("left", (_e, cx) => {
          const d = this.drag;
          this.drag = null;
          if (!d || d.id === todo.id || d.over !== todo.id) return cx.notify();
          const moving = shared("atlas")?.todos?.next.find((x) => x.id === d.id);
          if (moving) this.move(cx, moving, this.nextTo(moving, todo, d.after ? "after" : "before"), `moved ${d.after ? "below" : "above"} #${todo.id}`);
        });
    }
    el = el
      .child(div().w(14).flex_none().flex().justify_center().text_size(9).text_color(color).child(todo.status === "doing" ? "○" : "●"))
      .child(div().w(34).flex_none().text_size(10.5).text_color(t.dim).child(`#${todo.id}`))
      .child(this.title(t, todo))
      .when(Boolean(this.all || todo.group), (el) => el.child(div().flex_none().max_w(84).truncate().px(5).rounded(4).bg(t.chrome).text_size(10).text_color(t.muted).child(this.all ? [todo.repo ?? "personal", todo.group].filter(Boolean).join(" · ") : todo.group)))
      .child(div().w(26).flex_none().text_size(10.5).text_color(t.dim).child(when))
      .when(expanded, (el) => el.child(div().w(4).flex_none()));
    if (expanded) return v_flex().rounded(6).bg(t.hover).child(el).child(this.detail(t, todo));
    el = el
      .child(this.busy === todo.id ? div().w(20).text_size(11).text_color(t.dim).child("…")
        : todo.status === "doing" ? this.button(t, `apd-${todo.id}`, "✓", (cx) => this.status(cx, todo, "done"))
        : todo.status === "todo" ? this.button(t, `aps-${todo.id}`, "▸", (cx) => this.status(cx, todo, "doing"))
        : div().w(20))
      .when(open, (el) => el
        .child(this.button(t, `apa-${todo.id}`, "⏎", (cx, alt) => alt ? this.ask(cx, { todo, where: "agent" }) : this.send(cx, todo, "agent")))
        .child(this.button(t, `app-${todo.id}`, "⊞", (cx, alt) => alt ? this.ask(cx, { todo, where: "pane" }) : this.send(cx, todo, "pane")))
        .child(this.button(t, `apt-${todo.id}`, "⊟", (cx, alt) => alt ? this.ask(cx, { todo, where: "tab" }) : this.send(cx, todo, "tab"))));
    return el;
  }

  // A click opens the row. Titles that may be cut show in full after 1.2 s of hover; under 24 characters never are.
  title(t, todo) {
    const open = this.expanded?.id === todo.id;
    const text = div().w_full().min_w(0).when(!open, (el) => el.truncate()).text_size(12.5).text_color(todo.status === "done" ? t.muted : t.foreground).child(todo.title);
    const box = div().id(`apt-title-${todo.id}`).flex_1().min_w(0).overflow_hidden().cursor_pointer()
      .on_click((_e, cx) => { cx.stop_propagation(); this.handle.focus(); this.expand(cx, todo.id); });
    if (todo.title.length < 24 || open) return box.child(text);
    return box.child(HoverCard.new(`aph-${todo.id}`).w_full().open_delay(1200).close_delay(100).trigger(text)
      .content(div().max_w(360).p(8).rounded(6).bg(t.popover).border_1().border_color(t.border).text_size(12.5).text_color(t.foreground).child(todo.title)));
  }

  // H2 + H4 in chip-options.html#headings: status dot, name, count pill, then a rule.
  heading(t, title, count, extra) {
    // Doing is an empty ring, Next and Done filled, as on the rows.
    const dot = { Doing: t.foreground, Next: t.muted, Done: t.accent, "Waiting on you": t.working, Parked: t.dim }[title];
    // The dot sits in the rows' 14 px dot column, so it lines up with theirs.
    return h_flex().pr(8).pt(12).pb(4).gap(6).items_center().text_size(12).font_semibold().text_color(t.foreground)
      .child(div().w(14).flex_none().flex().justify_center()
        .when(Boolean(dot), (el) => el.child(title === "Doing" ? div().w(7).h(7).rounded_full().border_1().border_color(dot) : div().w(7).h(7).rounded_full().bg(dot)))
        .when(title === "Docs", (el) => el.child(svg("mods/workspace-chrome/file-text.svg").size(12).text_color(t.muted))))
      .child(div().flex_none().child(title))
      .child(div().flex_none().px(6).rounded(8).bg(t.hover).text_size(10.5).font_normal().text_color(t.muted).child(String(count)))
      .child(div().flex_1().h(1).bg(t.border))
      .when(Boolean(extra), (el) => el.child(extra));
  }

  cap(list, n) {
    return this.open?.[list] ? 50 : n;
  }

  // "N more" shows the rest of the list; "show less" folds it back.
  more(t, list, n) {
    const open = this.open?.[list];
    if (n <= 0 && !open) return null;
    return div().id(`apn-more-${list}`).ml(56).mr(8).px(8).h(22).flex().items_center().rounded(5).text_size(11).text_color(t.dim)
      .cursor_pointer().hover((el) => el.text_color(t.foreground))
      .on_click((_e, cx) => { this.open = { ...this.open, [list]: !open }; cx.notify(); })
      .child(open ? "show less" : `${n} more`);
  }

  section(t, title, all, cap, cx) {
    if (!all.length) return null;
    const n = this.cap(title, cap);
    return v_flex().child(this.heading(t, title, all.length)).children(all.slice(0, n).map((r) => this.row(t, r, cx))).children([this.more(t, title, all.length - n)].filter(Boolean));
  }

  done(t, all, cx) {
    if (!all.length) return null;
    const pages = Math.ceil(all.length / PAGE);
    const page = Math.min(this.page, pages - 1);
    const turn = (d) => (_e, cx) => { this.page = Math.max(0, Math.min(pages - 1, page + d)); cx.notify(); };
    const pager = pages > 1 && h_flex().gap(2).items_center().font_normal()
      .child(div().id("apn-newer").px(5).rounded(4).text_color(page ? t.muted : t.border).hover((el) => el.bg(t.hover)).on_click(turn(-1)).child("‹"))
      .child(div().child(`${page + 1}/${pages}`))
      .child(div().id("apn-older").px(5).rounded(4).text_color(page < pages - 1 ? t.muted : t.border).hover((el) => el.bg(t.hover)).on_click(turn(1)).child("›"));
    return v_flex().child(this.heading(t, "Done", all.length, pager || null)).children(all.slice(page * PAGE, page * PAGE + PAGE).map((r) => this.row(t, r, cx)));
  }

  // The session's docs: a plan or design gets the accent; a doc it only named, or one past
  // a day, is faded.
  docs(t, docs) {
    if (!docs.length) return null;
    const row = (doc) => h_flex().id(`apdoc-${doc.stem}`).h(26).pr(8).gap(6).items_center().rounded(6).cursor_pointer()
      .when(Boolean(doc.faded || !doc.changed), (el) => el.opacity(0.5))
      .when(this.sel === `d${doc.stem}`, (el) => el.bg(t.hover)).hover((el) => el.bg(t.hover))
      .on_click(() => openDoc(doc.open))
      .child(svg("mods/workspace-chrome/file-text.svg").size(13).w(14).flex_none().text_color(doc.effort ? t.accent : t.muted))
      .child(div().w(34).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(doc.name))
      .when(Boolean(doc.where), (el) => el.child(div().flex_none().max_w(84).truncate().px(5).rounded(4).bg(t.chrome).text_size(10).text_color(t.muted).child(doc.where)))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(doc.when)));
    return v_flex().child(this.heading(t, "Docs", docs.length))
      .children(docs.slice(0, this.cap("Docs", 10)).map(row)).children([this.more(t, "Docs", docs.length - this.cap("Docs", 10))].filter(Boolean));
  }

  // One chip per effort in view, plus "all"; shown only when the view spans more than one.
  filter(t, efforts) {
    if (efforts.length < 2) return null;
    const chip = (key, label, n) => div().id(`apn-effort-${label}`).flex_none().px(8).h(22).flex().items_center().gap(4).rounded(11).border_1().text_size(11).cursor_pointer()
      .border_color(this.effort === key ? t.accent : t.border).text_color(this.effort === key ? t.accent : t.muted)
      .hover((el) => el.text_color(t.foreground))
      .on_click((_e, cx) => { this.effort = key; this.page = 0; cx.notify(); })
      .child(div().max_w(140).truncate().child(label)).when(n != null, (el) => el.child(div().text_color(t.dim).child(String(n))));
    // The top 5 (and the selected one); "+N more" shows the rest.
    const shown = this.moreEfforts ? efforts : efforts.filter(([g], i) => i < 5 || g === this.effort);
    const rest = efforts.length - shown.length;
    return h_flex().flex_wrap().gap(4).px(6).py(4)
      .child(chip(null, "all", null)).children(shown.map(([g, n]) => chip(g, g, n)))
      .when(rest > 0 || this.moreEfforts, (el) => el.child(div().id("apn-effort-more").flex_none().px(8).h(22).flex().items_center().rounded(11).text_size(11).text_color(t.dim).cursor_pointer()
        .hover((el) => el.text_color(t.foreground)).on_click((_e, cx) => { this.moreEfforts = !this.moreEfforts; cx.notify(); })
        .child(this.moreEfforts ? "less" : `+${rest} more`)));
  }

  // The timeline's effort, loaded from render: only while the panel shows, at most once a
  // minute, and again when the session or repo changes. No timer, so a hidden panel costs nothing.
  loadTimeline(cx, s) {
    const session = shared("atlas.docs")?.session ?? null;
    const key = `${session}|${s?.repo?.id ?? ""}`;
    const old = this.tl;
    if (old?.key === key && (old.loading || Date.now() - old.at < 60000)) return;
    const mine = { key, at: Date.now(), loading: true, data: old?.key === key ? old.data : null, error: null };
    this.tl = mine;
    cx.spawn(async (cx) => {
      try { mine.data = await effortFor(session, s?.repo); }
      catch (e) { mine.error = e?.message === "atlas 404" ? "This Atlas server has no timeline yet." : `Atlas is offline: ${e?.message ?? "error"}`; }
      mine.loading = false;
      mine.at = Date.now();
      if (this.tl === mine) cx.notify();
    });
  }

  // As on the web page: what waits on you, then Doing, Next, Parked, and Done newest first.
  timeline(t) {
    const tl = this.tl;
    const v = tl?.data;
    const say = (text) => div().px(8).py(8).text_size(12).text_color(t.dim).child(text);
    if (!v) return [say(tl?.error ?? "Loading…")];
    if (!v.group) return [say("No effort linked to this session or repo. Link one with atlas timeline link.")];
    const by = (state) => v.entries.filter((e) => e.state === state);
    const waiting = v.entries.filter((e) => e.state !== "done").flatMap((e) => e.lines.filter((l) => l.kind === "waiting")).slice(0, 8);
    const done = by("done").sort((a, b) => (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));
    const part = (title, list, row) => list.length > 0 && v_flex().child(this.heading(t, title, list.length)).children(list.map(row));
    return [
      h_flex().id("apn-tl-effort").mx(2).px(8).h(30).gap(6).items_center().rounded(6).cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click(() => openTimeline(v.group.id))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).font_semibold().text_color(t.accent).child(v.group.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child([v.group.repo_name, v.group.branches].filter(Boolean).join(" · ")))
        .child(svg("mods/atlas-chip/link.svg").size(11).flex_none().text_color(t.dim)),
      tl.error && say(tl.error),
      part("Waiting on you", waiting, (l) => h_flex().pr(8).py(3).gap(6).items_start().text_size(12)
        .child(div().w(14).flex_none())
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(cut(l.text, 200)))),
      part("Doing", by("doing"), (e) => this.entry(t, e)),
      part("Next", by("todo"), (e) => this.entry(t, e)),
      part("Parked", by("parked"), (e) => this.entry(t, e)),
      part("Done", done, (e) => this.entry(t, e)),
    ].filter(Boolean);
  }

  // One entry: its dot, title and days; under it the note, or an open entry's last 4 lines.
  entry(t, e) {
    const open = e.state !== "done";
    const lines = open ? e.lines.filter((l) => l.kind !== "waiting" && l.kind !== "evidence").slice(-4) : [];
    const under = (text, color) => h_flex().gap(6).child(div().w(14).flex_none()).child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(color).child(cut(text, 200)));
    return v_flex().pb(4)
      .child(h_flex().h(26).pr(8).gap(6).items_center()
        .child(div().w(14).flex_none().flex().justify_center().text_size(9).text_color({ doing: t.foreground, done: t.accent }[e.state] ?? t.muted).child(e.state === "doing" ? "○" : "●"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(open ? t.foreground : t.muted).child(e.title))
        .when(e.merged, (el) => el.child(div().flex_none().px(5).rounded(4).bg(t.chrome).text_size(10).text_color(t.muted).child("merged")))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(days(e))))
      .when(Boolean(e.note), (el) => el.child(under(e.note, t.muted)))
      .children(lines.map((l) => under(l.text, t.dim)));
  }

  // Which view is showing, and a click on another one switches to it. Timeline is this panel's own.
  switcher(t, s) {
    const tab = (k, label, on) => div().id(`apn-scope-${k}`).px(8).h_full().flex().items_center().rounded(4).text_size(11)
      .when(on, (el) => el.bg(t.background).text_color(t.accent).font_semibold())
      .when(!on, (el) => el.text_color(t.dim).cursor_pointer().hover((el) => el.text_color(t.foreground)))
      .on_click((_e, cx) => this.pick(cx, k))
      .child(label);
    const todos = this.mode === "todos";
    return h_flex().flex_none().h(22).p(2).gap(2).rounded(6).bg(t.chrome).border_1().border_color(t.border)
      .children(SCOPES.map(([k, label]) => tab(k, label, todos && s?.scope === k)))
      .child(tab("timeline", "timeline", !todos));
  }

  render(cx) {
    const t = theme();
    const s = shared("atlas");
    const { docs, todos, summary, efforts } = this.lists();
    if (s?.repo?.dir !== this.repo || s?.view !== this.view) { this.repo = s?.repo?.dir ?? null; this.view = s?.view; this.page = 0; this.sel = null; this.effort = null; }
    // Tag rows with their repo when the view spans more than one.
    this.all = s?.scope === "all" || (s?.view === "session" && new Set([...(todos?.doing ?? []), ...(todos?.next ?? []), ...(todos?.done ?? [])].map((x) => x.repo)).size > 1);
    const empty = todos && !todos.doing.length && !todos.next.length && !todos.done.length;
    const onTimeline = this.mode === "timeline" && s?.applies;
    if (onTimeline) this.loadTimeline(cx, s);
    const body = !s?.applies ? "Focus an agent in a repo with atlas notes."
      : onTimeline ? null
      : !todos ? (s.error ? `Atlas is offline: ${s.error}` : "Loading…") : null;
    const c = this.compose;
    return v_flex().id("atlas-panel").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).focus((el) => el.border_color(t.accent)).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; cx.notify(); } })
      .child(h_flex().h(34).flex_none().px(12).gap(6).items_center().border_b_1().border_color(t.border).text_size(12)
        .child(svg("mods/atlas-chip/atlas.svg").size(13).flex_none().text_color(t.accent))
        .child(div().flex_1().truncate().child("atlas"))
        .when(Boolean(this.note), (el) => el.child(div().text_size(11).text_color(t.accent).child(this.note)))
        .when(Boolean(s?.error && todos), (el) => el.child(div().text_size(11).text_color(t.dim).child("offline")))
        .when(Boolean(s?.applies), (el) => el
          .child(div().id("apn-add").px(6).h(20).flex().items_center().rounded(5).text_size(13).text_color(t.dim).hover((el) => el.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.ask(cx, { add: true })).child("+"))
          .child(this.switcher(t, s))))
      .when(Boolean(c), (el) => el.child(h_flex().h(36).flex_none().px(10).gap(8).items_center().border_b_1().border_color(t.border)
        .child(div().flex_none().text_size(11).text_color(t.dim).child(c.add ? "+ Inbox" : { agent: "⏎ agent", pane: "⊞ pane", tab: "⊟ tab" }[c.where]))
        .child(div().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))))
      .child(v_flex().id("atlas-panel-scroll").flex_1().min_h(0).overflow_y_scroll().p(6).pb(16)
        .when(Boolean(body), (el) => el.child(div().px(8).py(8).text_size(12).text_color(t.dim).child(body)))
        .children(onTimeline ? this.timeline(t) : [
          s?.view === "fallback" && div().px(8).py(6).text_size(11.5).text_color(t.dim).child(`No session activity yet: showing ${s.repo?.name ?? "personal"}.`),
          summary && div().id("apn-summary").mx(2).px(8).h(28).flex().items_center().rounded(6).text_size(12).text_color(t.muted).cursor_pointer()
            .hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click(() => setScope("session")).child(`${summary} →`),
          this.filter(t, efforts),
          empty && div().px(8).py(8).text_size(12).text_color(t.dim).child("Nothing doing, next or done here."),
          // The session view always shows Doing, so an empty one reads as "nothing started".
          todos && !empty && s?.view === "session" && !todos.doing.length && v_flex().child(this.heading(t, "Doing", 0))
            .child(div().px(8).py(4).text_size(12).text_color(t.dim).child("Nothing in progress. ▸ starts a todo.")),
          todos && this.section(t, "Doing", todos.doing, 8, cx),
          todos && this.section(t, "Next", todos.next, 12, cx),
          todos && this.done(t, todos.done, cx),
          this.docs(t, docs),
        ].filter(Boolean)))
      .child(h_flex().flex_none().flex_wrap().px(12).py(6).gap_x(12).gap_y(4).items_center().border_t_1().border_color(t.border).text_size(12)
        .children((onTimeline ? [["r", "view"]] : KEYS).map(([k, what]) => h_flex().gap(4).items_center()
          .child(div().px(5).rounded(4).bg(t.chrome).border_1().border_color(t.border).text_color(t.foreground).child(k))
          .child(div().text_color(t.muted).child(what)))));
  }
}
