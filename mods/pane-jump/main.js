// alt-tab, held: the 9 most recent panes in every space, the previous one selected, so a tap
// goes back. While alt is down, Tab moves on, ` moves back, 1-9 jump, and letting go goes.
// Those alt keys reach us as commands from keys.json's "mod:pane-jump" section, which beats the
// global alt-tab that opened us. The order is shared pane.recent, written by my-status.
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { panes, spaces, shared, focused, run, theme, props, closeOverlay, nextCommand, home } from "herdr";

const ROW = 44;
const MAX = 9;

// As my-pane names a pane: the agent or shell by its program name, anything else by its title.
const nameOf = (p) => ((p.program?.agent || p.program?.shell) && p.program.name) || p.title || p.program?.name || "shell";
// Claude's title is its session topic; a shell's is user@host:path, so show its folder instead.
const detailOf = (p) => p.program?.shell ? (p.cwd ?? "").replace(home(), "~") : p.title === nameOf(p) ? "" : p.title;

export default class PaneJump extends View {
  init(_props, cx) {
    this.at = 0;
    this.opening = true;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        this.opening = false;
        if (/^[1-9]$/.test(c)) return this.go(this.rows()[Number(c) - 1]);
        this.move(c === "prev" ? -1 : 1);
        cx.notify();
      }
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const spaceOf = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
    const recent = shared("pane.recent") ?? [];
    const rank = (p) => { const i = recent.indexOf(p.pane); return i === -1 ? recent.length : i; };
    const here = focused()?.pane;
    return panes().filter((p) => p.terminal && p.pane !== here)
      .sort((a, b) => rank(a) - rank(b))
      .slice(0, MAX)
      .map((p) => ({ ...p, space: spaceOf.get(p.tab) }));
  }

  move(by) {
    const n = this.rows().length;
    if (n) this.at = (this.at + by + n) % n;
  }

  // Space, then tab, then the pane: the pane may be in another space.
  go(p) {
    if (!p) return;
    this.close();
    if (p.space) run("space.select", { id: p.space.id });
    run("tab.select", { id: p.tab });
    run("pane.focus", { pane: p.pane });
  }

  render() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    const pic = (pr) => !pr?.icon ? div().size(20).flex_none()
      : pr.tint ? svg(pr.icon).size(20).flex_none().text_color(t.muted) : image(pr.icon).w(20).h(20).flex_none();

    const row = (p, i) => h_flex().id(`pj-${p.pane}`).h(ROW).flex_none().px(12).gap(12).rounded(8).items_center().cursor_pointer()
      .when(i === this.at, (el) => el.bg(t.hover))
      .hover((el) => el.bg(t.hover))
      .on_click(() => this.go(p))
      .child(div().w(14).flex_none().text_size(12).font_semibold().text_color(i === this.at ? t.accent : t.dim).child(String(i + 1)))
      .child(pic(p.program))
      .child(h_flex().flex_1().min_w(0).gap(10).items_center()
        .child(div().flex_none().text_size(14).font_semibold().text_color(t.foreground).child(nameOf(p)))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.muted).child(detailOf(p))))
      .child(div().max_w(150).flex_none().truncate().text_size(12).text_color(t.muted).child(p.space?.name ?? ""))
      .child(div().w(36).flex_none().text_size(11).text_color(t.dim).child(p.terminal));

    return v_flex()
      .id("pane-jump")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(10)
      .gap(8)
      .bg(t.popover)
      .text_size(14)
      .on_modifiers_changed((e) => { if (!e.modifiers.alt) this.go(rows[this.at]); })
      // A quick tap can let go of alt before we have the keyboard; the opening Tab's release still tells.
      .on_key_up((e) => { if (e.key === "tab" && this.opening) { this.opening = false; if (!e.modifiers.alt) this.go(rows[this.at]); } })
      .on_key_down((e, cx) => {
        this.opening = false;
        if (e.key === "escape") return this.close();
        if (/^[1-9]$/.test(e.key)) return this.go(rows[Number(e.key) - 1]);
        if (e.key === "enter") return this.go(rows[this.at]);
        // With alt down these come as commands (see the top); taking them here too would move twice.
        if (e.modifiers.alt) return;
        if (e.key === "up" || e.key === "`" || (e.key === "tab" && e.modifiers.shift)) this.move(-1);
        else if (e.key === "down" || e.key === "tab") this.move(1);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(v_flex().id("pj-list").h(Math.max(1, rows.length) * ROW).flex_none()
        .when(!rows.length, (el) => el.child(div().px(14).py(10).text_color(t.dim).child("No other pane")))
        .children(rows.map(row)))
      .child(div().px(12).text_size(11).text_color(t.dim).child("Tab next · ` back · 1–9 jump · let go of ⌥ to go · Esc"));
  }
}
