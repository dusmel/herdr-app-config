// The atlas page of the right panel: a timeline of Doing, Next and Done (20 a page)
// with group tags, then this session's docs. Reads shared "atlas" and "atlas.docs"
// (atlas-chip loads both). At most 50 rows: 8 doing, 12 next, 20 done, 10 docs.
// Keys and mouse actions: atlas/repos/herdr/herdr-app/atlas-mod/design.html#actions.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { theme, shared, setShared, run, hc, agents, nextCommand } from "herdr";
import { updateTodo, moveTodo, addTodo, repoRef, PERSONAL, ago, openDoc } from "./api.js";

const PAGE = 20;
const message = (todo, extra) =>
  `Work on atlas todo #${todo.id}: ${todo.title}. Read it with \`atlas todo show ${todo.id}\`, run \`atlas todo start ${todo.id}\`, and \`atlas todo done ${todo.id}\` when finished.${extra ? `\n\n${extra}` : ""}`;

export default class AtlasPanel extends View {
  init(_props, cx) {
    this.page = 0;
    this.busy = null;
    this.repo = null;
    this.sel = null; // "t<id>" or "d<stem>"
    this.note = null;
    this.compose = null; // { todo, where } for an extra message, or { add: true }
    this.drag = null; // { id, over, after }
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
    const next = s.todos.next.filter((x) => x.id !== todo.id);
    const moved = { ...todo, priority: body.priority ?? todo.priority };
    const at = body.top ? 0 : next.findIndex((x) => x.id === (body.before ?? body.after)) + (body.after ? 1 : 0);
    next.splice(Math.max(0, at), 0, moved);
    setShared("atlas", { ...s, todos: { ...s.todos, next } });
    this.busy = todo.id;
    cx.notify();
    cx.spawn(async (cx) => {
      const ok = await moveTodo(todo.id, body).then(() => true, () => false);
      this.busy = null;
      this.say(cx, ok ? `#${todo.id} ${label}` : "move failed");
      this.refresh();
    });
  }

  nextTo(todo, other, side) {
    const body = { [side]: other.id };
    if (other.priority && other.priority !== todo.priority) body.priority = other.priority;
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

  // Inbox: no priority. In "all repos" scope it goes to the personal list.
  add(cx, title) {
    if (!title) return cx.notify();
    const s = shared("atlas");
    addTodo({ title, repo: s?.scope === "all" ? PERSONAL : repoRef(s?.repo) })
      .then((t) => { this.say(cx, `added #${t?.id ?? ""}`); this.refresh(); }, () => this.say(cx, "add failed"));
  }

  // The rows in screen order, for the keyboard.
  rows() {
    const s = shared("atlas");
    const t = s?.applies ? s.todos : null;
    if (!t) return [];
    const page = Math.min(this.page, Math.max(0, Math.ceil(t.done.length / PAGE) - 1));
    const docs = (shared("atlas.docs")?.list ?? []).slice(0, 10);
    return [
      ...t.doing.slice(0, 8), ...t.next.slice(0, 12), ...t.done.slice(page * PAGE, page * PAGE + PAGE),
    ].map((todo) => ({ key: `t${todo.id}`, todo })).concat(docs.map((doc) => ({ key: `d${doc.stem}`, doc })));
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
    if (action === "scope") {
      if (!s?.applies) return;
      setShared("atlas", { ...s, scope: s.scope === "all" ? "repo" : "all", todos: null });
      return this.refresh();
    }
    if (action.startsWith("select-")) { this.sel = `t${action.slice(7)}`; return cx.notify(); }
    const row = rows[i];
    if (!row) return;
    if (row.doc) { if (action === "agent") openDoc(row.doc.open); return; }
    const todo = row.todo;
    if (["agent", "pane", "tab"].includes(action)) return alt ? this.ask(cx, { todo, where: action }) : this.send(cx, todo, action);
    if (action === "start" && todo.status !== "doing") return this.status(cx, todo, "doing");
    if (action === "done" && todo.status !== "done") return this.status(cx, todo, "done");
    if (todo.status !== "todo") return;
    const next = s.todos.next;
    const at = next.findIndex((x) => x.id === todo.id);
    if (action === "move-up" && at > 0) this.move(cx, todo, this.nextTo(todo, next[at - 1], "before"), "moved up");
    if (action === "move-down" && at >= 0 && at < next.length - 1) this.move(cx, todo, this.nextTo(todo, next[at + 1], "after"), "moved down");
    if (action === "move-top" && at > 0) this.move(cx, todo, { top: true, ...(next[0].priority && next[0].priority !== todo.priority ? { priority: next[0].priority } : {}) }, "moved to the top");
  }

  key(e, cx) {
    if (this.compose) {
      if (e.key === "escape") { this.compose = null; this.handle.focus(); cx.stop_propagation(); cx.notify(); }
      return;
    }
    const m = e.modifiers;
    if (m.platform || m.control) return;
    const action = m.shift
      ? { up: "move-up", down: "move-down", t: "move-top" }[e.key]
      : { up: "up", down: "down", enter: "agent", p: "pane", t: "tab", s: "start", d: "done", a: "add", r: "scope" }[e.key];
    if (!action) return;
    cx.stop_propagation();
    this.act(cx, action, m.alt);
  }

  button(t, id, label, fn) {
    return div().id(id).flex_none().px(5).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.dim)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((e, cx) => { cx.stop_propagation(); fn(cx, e.modifiers.alt); }).child(label);
  }

  // One timeline row: a dot on the line, #id, title, group, a time and actions.
  // Next rows drag: press on one, release on another to drop it there.
  row(t, todo, cx) {
    const color = { doing: t.accent, todo: t.muted, done: t.dim }[todo.status];
    const when = todo.status === "doing" ? ago(todo.updated) : todo.status === "done" ? ago(todo.done) : todo.priority ?? "";
    const key = `t${todo.id}`;
    const selected = this.sel === key;
    const open = todo.status !== "done";
    const drop = this.drag && this.drag.over === todo.id && this.drag.id !== todo.id;
    const pick = (cx) => { this.sel = key; this.handle.focus(); cx.notify(); };
    let el = h_flex().id(`apn-${todo.id}`).h(28).pr(4).gap(6).items_center().rounded(6)
      .when(selected, (el) => el.bg(t.hover)).hover((el) => el.bg(t.hover))
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
    return el
      .child(div().w(14).flex_none().flex().justify_center().text_size(9).text_color(color).child(todo.status === "done" ? "○" : "●"))
      .child(div().w(34).flex_none().text_size(10.5).text_color(t.dim).child(`#${todo.id}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(todo.status === "done" ? t.muted : t.foreground).child(todo.title))
      .when(Boolean(this.all || todo.group), (el) => el.child(div().flex_none().max_w(84).truncate().px(5).rounded(4).bg(t.chrome).text_size(10).text_color(t.muted).child(this.all ? [todo.repo ?? "personal", todo.group].filter(Boolean).join(" · ") : todo.group)))
      .child(div().w(26).flex_none().text_size(10.5).text_color(t.dim).child(when))
      .child(this.busy === todo.id ? div().w(20).text_size(11).text_color(t.dim).child("…")
        : todo.status === "doing" ? this.button(t, `apd-${todo.id}`, "✓", (cx) => this.status(cx, todo, "done"))
        : todo.status === "todo" ? this.button(t, `aps-${todo.id}`, "▸", (cx) => this.status(cx, todo, "doing"))
        : div().w(20))
      .when(open, (el) => el
        .child(this.button(t, `apa-${todo.id}`, "▶", (cx, alt) => alt ? this.ask(cx, { todo, where: "agent" }) : this.send(cx, todo, "agent")))
        .child(this.button(t, `app-${todo.id}`, "⊞", (cx, alt) => alt ? this.ask(cx, { todo, where: "pane" }) : this.send(cx, todo, "pane")))
        .child(this.button(t, `apt-${todo.id}`, "⊟", (cx, alt) => alt ? this.ask(cx, { todo, where: "tab" }) : this.send(cx, todo, "tab"))));
  }

  heading(t, title, extra) {
    return h_flex().px(8).pt(10).pb(3).gap(6).items_center().text_size(10.5).font_semibold().text_color(t.dim)
      .child(div().flex_1().child(title)).when(Boolean(extra), (el) => el.child(extra));
  }

  more(t, n) {
    return n > 0 ? div().pl(64).py(2).text_size(11).text_color(t.dim).child(`${n} more`) : null;
  }

  section(t, title, all, cap, cx) {
    if (!all.length) return null;
    return v_flex().child(this.heading(t, `${title} · ${all.length}`)).children(all.slice(0, cap).map((r) => this.row(t, r, cx))).children([this.more(t, all.length - cap)].filter(Boolean));
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
    return v_flex().child(this.heading(t, `Done · ${all.length}`, pager || null)).children(all.slice(page * PAGE, page * PAGE + PAGE).map((r) => this.row(t, r, cx)));
  }

  docs(t, d) {
    const list = d?.list ?? [];
    if (!list.length) return null;
    const row = (doc) => h_flex().id(`apdoc-${doc.stem}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer()
      .when(this.sel === `d${doc.stem}`, (el) => el.bg(t.hover)).hover((el) => el.bg(t.hover))
      .on_click(() => openDoc(doc.open))
      .child(div().w(14).flex_none().text_size(10).text_color(doc.effort ? t.accent : t.dim).child(doc.effort ? "◆" : "◇"))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(doc.name))
      .when(Boolean(doc.where), (el) => el.child(div().flex_none().max_w(84).truncate().px(5).rounded(4).bg(t.chrome).text_size(10).text_color(t.muted).child(doc.where)))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(doc.mtime)));
    return v_flex().child(this.heading(t, `This session's docs · ${list.length}`)).children(list.slice(0, 10).map(row)).children([this.more(t, list.length - 10)].filter(Boolean));
  }

  render(cx) {
    const t = theme();
    const s = shared("atlas");
    const d = shared("atlas.docs");
    if (s?.repo?.dir !== this.repo) { this.repo = s?.repo?.dir ?? null; this.page = 0; this.sel = null; }
    const todos = s?.applies ? s.todos : null;
    this.all = s?.scope === "all";
    const empty = todos && !todos.doing.length && !todos.next.length && !todos.done.length;
    const body = !s?.applies ? "Focus an agent in a repo with atlas notes."
      : !todos ? (s.error ? `Atlas is offline: ${s.error}` : "Loading…") : empty ? "No todos here yet." : null;
    const c = this.compose;
    return v_flex().id("atlas-panel").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground)
      .on_key_down((e, cx) => this.key(e, cx))
      .on_mouse_up("left", (_e, cx) => { if (this.drag) { this.drag = null; cx.notify(); } })
      .child(h_flex().h(34).flex_none().px(12).gap(6).items_center().border_b_1().border_color(t.border).text_size(12)
        .child(div().text_color(t.accent).child("◆"))
        .child(div().flex_1().truncate().child(this.all ? "atlas · all repos" : `atlas · ${s?.repo?.name ?? "personal"}`))
        .when(Boolean(this.note), (el) => el.child(div().text_size(11).text_color(t.accent).child(this.note)))
        .when(Boolean(s?.error && todos), (el) => el.child(div().text_size(11).text_color(t.dim).child("offline")))
        .when(Boolean(s?.applies), (el) => el
          .child(div().id("apn-add").px(6).h(20).flex().items_center().rounded(5).text_size(13).text_color(t.dim).hover((el) => el.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.ask(cx, { add: true })).child("+"))
          .child(div().id("apn-scope").px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.dim).hover((el) => el.bg(t.hover).text_color(t.foreground))
            .on_click((_e, cx) => this.act(cx, "scope", false)).child(this.all ? "this repo" : "all repos"))))
      .when(Boolean(c), (el) => el.child(h_flex().h(36).flex_none().px(10).gap(8).items_center().border_b_1().border_color(t.border)
        .child(div().flex_none().text_size(11).text_color(t.dim).child(c.add ? "+ Inbox" : { agent: "▶ agent", pane: "⊞ pane", tab: "⊟ tab" }[c.where]))
        .child(div().flex_1().min_w(0).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.accent)
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .child(Input.new(this.input).h_full().text_size(12).text_color(t.foreground)))))
      .child(v_flex().id("atlas-panel-scroll").flex_1().min_h(0).overflow_y_scroll().p(6).pb(16)
        .when(Boolean(body), (el) => el.child(div().px(8).py(8).text_size(12).text_color(t.dim).child(body)))
        .when(Boolean(todos), (el) => el.children([
          this.section(t, "Doing", todos.doing, 8, cx),
          this.section(t, "Next", todos.next, 12, cx),
          this.done(t, todos.done, cx),
          this.docs(t, d),
        ].filter(Boolean))))
      .child(h_flex().h(24).flex_none().px(12).items_center().border_t_1().border_color(t.border).text_size(10.5).text_color(t.dim)
        .child("⏎ send · p pane · t tab · ⌥ +msg · ⇧↑↓ ⇧t move · a add · r scope"));
  }
}
