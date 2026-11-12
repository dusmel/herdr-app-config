// The atlas chip's hover popup: the view switch (session, repo, all), then Doing, the top
// of Next (start, done) and, in the session view, its docs. Reads shared "atlas",
// "atlas.mine" and "atlas.docs" (atlas-chip loads them); asks for a refresh after an
// action. Rows: popRows in api.js.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay } from "herdr";
import { updateTodo, ago, openDoc, popRows, actingFor, setScope, SCOPES } from "./api.js";

export default class AtlasPop extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.busy = null;
  }

  close() {
    setShared("atlas.pop", null);
    closeOverlay(props().overlay);
  }

  act(cx, todo, status) {
    this.busy = todo.id;
    cx.notify();
    cx.spawn(async (cx) => {
      const s = shared("atlas"), d = shared("atlas.docs");
      actingFor({ session: d?.session, terminal: s?.terminal });
      await updateTodo(todo.id, { status }).catch(() => null);
      this.busy = null;
      setShared("atlas.want", Date.now());
      cx.notify();
    });
  }

  button(t, id, label, fn) {
    return div().id(id).flex_none().px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.dim)
      .hover((el) => el.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => { cx.stop_propagation(); fn(cx); }).child(label);
  }

  row(t, todo, cx) {
    const doing = todo.status === "doing";
    const done = todo.status === "done";
    return h_flex().id(`ap-${todo.id}`).h(28).px(8).gap(8).items_center().rounded(6).hover((el) => el.bg(t.hover))
      .when(Boolean(todo.faded), (el) => el.opacity(0.5))
      .child(div().w(14).flex_none().text_size(9).text_color(done ? t.accent : doing ? t.foreground : t.muted).child(doing ? "○" : "●"))
      .child(div().w(34).flex_none().text_size(10.5).text_color(t.dim).child(`#${todo.id}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(done ? t.muted : t.foreground).child(todo.title))
      .when(Boolean(todo.group), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(10.5).text_color(t.muted).child(todo.group)))
      .child(div().w(28).flex_none().text_size(10.5).text_color(t.dim).child(done ? ago(todo.done) : doing ? ago(todo.updated) : todo.priority ?? ""))
      .child(this.busy === todo.id ? div().w(44).text_size(11).text_color(t.dim).child("…")
        : done ? div().w(44)
        : doing ? this.button(t, `ad-${todo.id}`, "✓ done", (cx) => this.act(cx, todo, "done"))
        : this.button(t, `as-${todo.id}`, "▸ start", (cx) => this.act(cx, todo, "doing")));
  }

  // A plan or design gets the accent; a doc the session only named, or past a day, is faded.
  doc(t, doc) {
    return h_flex().id(`apdoc-${doc.stem}`).h(28).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((el) => el.bg(t.hover))
      .when(Boolean(doc.faded || !doc.changed), (el) => el.opacity(0.5))
      .on_click(() => { openDoc(doc.open); this.close(); })
      .child(svg("mods/workspace-chrome/file-text.svg").size(13).w(14).flex_none().text_color(doc.effort ? t.accent : t.muted))
      .child(div().w(34).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(doc.name))
      .when(Boolean(doc.where), (el) => el.child(div().flex_none().max_w(110).truncate().text_size(10.5).text_color(t.muted).child(doc.where)))
      .child(div().w(28).flex_none().text_size(10.5).text_color(t.dim).child(ago(doc.when)))
      .child(div().w(44).flex_none());
  }

  heading(t, title) {
    return div().px(8).pt(4).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(title);
  }

  // Which view is showing, and a click on another one switches to it.
  switcher(t, s) {
    return h_flex().flex_none().h(22).p(2).gap(2).rounded(6).bg(t.chrome).border_1().border_color(t.border)
      .children(SCOPES.map(([k, label]) => div().id(`ap-scope-${k}`).px(8).h_full().flex().items_center().rounded(4).text_size(11)
        .when(s?.scope === k, (el) => el.bg(t.background).text_color(t.accent).font_semibold())
        .when(s?.scope !== k, (el) => el.text_color(t.dim).cursor_pointer().hover((el) => el.text_color(t.foreground)))
        .on_click((_e, cx) => { cx.stop_propagation(); setScope(k); })
        .child(label)));
  }

  render(cx) {
    const t = theme();
    const s = shared("atlas");
    const d = shared("atlas.docs");
    const r = popRows(s, shared("atlas.mine"), d, d?.key);
    const todos = s?.todos;
    const note = (text) => div().px(8).h(24).flex().items_center().text_size(11).text_color(t.dim).child(text);
    const parts = [
      r.note && note(r.note),
      r.doing.length && v_flex().gap(1).child(this.heading(t, "Doing")).children(r.doing.map((x) => this.row(t, x, cx))),
      r.next.length && v_flex().gap(1).child(this.heading(t, "Next")).children(r.next.map((x) => this.row(t, x, cx))),
      r.docs.length && v_flex().gap(1).child(this.heading(t, "Docs")).children(r.docs.map((x) => this.doc(t, x))),
      r.summary && div().id("ap-summary").px(8).h(28).flex().items_center().rounded(6).text_size(11.5).text_color(t.muted).cursor_pointer()
        .hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click(() => setScope("session")).child(`${r.summary} →`),
    ].filter(Boolean);
    return v_flex().id("atlas-pop").track_focus(this.handle).size_full().overflow_y_scroll().p(6).gap(4).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .on_hover((on) => { if (!on) this.close(); })
      .child(h_flex().px(8).h(28).gap(6).items_center().text_size(11).text_color(t.dim)
        .child(svg("mods/atlas-chip/atlas.svg").size(12).flex_none().text_color(t.accent))
        .child(div().flex_1().child("atlas"))
        .when(Boolean(s?.error), (el) => el.child(div().child("offline")))
        .when(Boolean(s?.applies), (el) => el.child(this.switcher(t, s))))
      .when(!todos && !s?.error, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Loading…")))
      .when(Boolean(todos) && !r.doing.length && !r.next.length && !r.docs.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Nothing doing or next")))
      .children(parts);
  }
}
