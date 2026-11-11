// cmd-alt-k (and cmd-shift-k for now): the tabs of the shown space. Press a tab's number to go there,
// ↑/↓ and Enter also work, / opens a filter, Esc leaves.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, run, theme, props, closeOverlay } from "herdr";

const ROW = 30;
const MAX_ROWS = 14;

export default class TabJump extends View {
  init(_props, cx) {
    this.filter = "";
    this.searching = false;
    this.at = null;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.input = InputState.new({ placeholder: "Filter tabs…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const f = this.filter.toLowerCase();
    return (spaces().find((s) => s.active)?.tabs ?? []).filter((t) => !f || t.name.toLowerCase().includes(f));
  }

  go(tab) {
    if (!tab) return;
    this.close();
    run("tab.select", { id: tab.id });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at === null) this.at = Math.max(0, rows.findIndex((r) => r.active));
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const start = Math.max(0, Math.min(this.at - MAX_ROWS + 1, rows.length - MAX_ROWS));
    const shown = rows.slice(start, start + MAX_ROWS);

    const row = (tab) => h_flex().id(`tj-${tab.id}`).h(ROW).flex_none().px(10).gap(10).rounded(7).items_center().cursor_pointer()
      .when(rows[this.at] === tab, (el) => el.bg(t.hover))
      .hover((el) => el.bg(t.hover))
      .on_click(() => this.go(tab))
      .child(div().w(18).flex_none().text_size(12).font_semibold().text_color(tab.active ? t.accent : t.dim).child(String(tab.index)))
      .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(tab.name))
      .when(tab.panes > 1, (el) => el.child(div().text_size(11).text_color(t.dim).child(`${tab.panes} panes`)))
      .when(tab.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
      .child(this.glyph(t, tab.status));

    return v_flex()
      .id("tab-jump")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(8)
      .gap(6)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.close();
        if (!this.searching && e.key === "/") { this.searching = true; this.input.focus(); }
        else if (!this.searching && /^[1-9]$/.test(e.key)) return this.go(rows.find((r) => r.index === Number(e.key)));
        else if (e.key === "enter" && !this.searching) return this.go(rows[this.at]);
        else if (rows.length && e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (rows.length && e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .when(this.searching, (el) => el.child(h_flex().h(32).flex_none().px(10).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(svg("mods/workspace-chrome/search.svg").size(14).text_color(t.dim))
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground))))
      .child(v_flex().id("tj-list").h(Math.max(1, Math.min(MAX_ROWS, rows.length)) * ROW).flex_none().overflow_hidden()
        .when(!rows.length, (el) => el.child(div().px(14).py(8).text_color(t.dim).child("No tab matches")))
        .children(shown.map(row)))
      .when(!this.searching, (el) => el.child(div().px(10).text_size(10.5).text_color(t.dim).child("1–9 go · / filter · Esc")));
  }
}
