// The atlas chip's hover popup: Doing, the top 3 of Next (start, done), and up to 4 session docs.
// Reads shared "atlas" (atlas-chip loads it); asks for a refresh after an action.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, shared, setShared, props, closeOverlay } from "herdr";
import { updateTodo, ago, openDoc } from "./api.js";

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
    return h_flex().id(`ap-${todo.id}`).h(28).px(8).gap(8).items_center().rounded(6).hover((el) => el.bg(t.hover))
      .child(div().w(34).flex_none().text_size(10.5).text_color(t.dim).child(`#${todo.id}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(todo.title))
      .when(Boolean(todo.group), (el) => el.child(div().flex_none().max_w(90).truncate().text_size(10.5).text_color(t.muted).child(todo.group)))
      .when(doing, (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(todo.updated))))
      .child(this.busy === todo.id
        ? div().w(44).text_size(11).text_color(t.dim).child("…")
        : doing ? this.button(t, `ad-${todo.id}`, "✓ done", (cx) => this.act(cx, todo, "done"))
          : this.button(t, `as-${todo.id}`, "▸ start", (cx) => this.act(cx, todo, "doing")));
  }

  section(t, title, rows, cx) {
    if (!rows.length) return null;
    return v_flex().gap(1)
      .child(div().px(8).pt(4).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(title))
      .children(rows.map((r) => this.row(t, r, cx)));
  }

  // This session's docs, plans and designs first; a click opens one in Phi.
  docs(t, list) {
    if (!list.length) return null;
    return v_flex().gap(1)
      .child(div().px(8).pt(4).pb(2).text_size(10.5).font_semibold().text_color(t.dim).child(`Docs · ${list.length}`))
      .children(list.slice(0, 4).map((doc) => h_flex().id(`apdoc-${doc.stem}`).h(26).px(8).gap(8).items_center().rounded(6).cursor_pointer().hover((el) => el.bg(t.hover))
        .on_click(() => { openDoc(doc.open); this.close(); })
        .child(div().w(34).flex_none().text_size(10).text_color(doc.effort ? t.accent : t.dim).child(doc.effort ? "◆" : "◇"))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).child(doc.name))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child(ago(doc.mtime)))));
  }

  render(cx) {
    const t = theme();
    const s = shared("atlas");
    const todos = s?.todos;
    const parts = [
      todos && this.section(t, "Doing", todos.doing.slice(0, 8), cx),
      todos && this.section(t, "Next", todos.next.slice(0, 3), cx),
      this.docs(t, shared("atlas.docs")?.list ?? []),
    ].filter(Boolean);
    return v_flex().id("atlas-pop").track_focus(this.handle).w_full().p(6).gap(4).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .on_hover((on) => { if (!on) this.close(); })
      .child(h_flex().px(8).h(24).gap(6).items_center().text_size(11).text_color(t.dim)
        .child(div().text_color(t.accent).child("◆"))
        .child(div().flex_1().child(s?.scope === "all" ? "atlas · all repos" : `atlas · ${s?.repo?.name ?? "personal"}`))
        .when(Boolean(s?.error), (el) => el.child(div().child("offline"))))
      .when(!todos && !s?.error, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Loading…")))
      .when(Boolean(todos) && !parts.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("Nothing doing, next or changed")))
      .children(parts);
  }
}
