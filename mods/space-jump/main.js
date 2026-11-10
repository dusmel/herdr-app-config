// Spaces only, like the TUI's spaces popup: every space with its worktrees
// under it, type to filter, ↑/↓ and Enter to go, Esc to leave.
// The number is the one alt-N and ctrl-N go to: worktrees don't count.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, run, theme, props, closeOverlay, home } from "herdr";

const ROW = 30;
// The popup sizes to its content, so the list can't take its row count from
// its own height: a short filtered list would stay short after clearing.
const MAX_ROWS = 14;

// Same test as the go-space-N mods (mods can't share files).
const isWorktree = (s) => (s.folder ?? "").includes("/.claude/worktrees/") || (s.folder ?? "").startsWith(`${home()}/.herdr/worktrees/`);

// The checkout a worktree space belongs to, from its folder: the recipe's
// `<repo>/.claude/worktrees/<slug>` or herdr-app's `~/.herdr/worktrees/<repo>/<branch>`.
function parentOf(s, all) {
  const f = s.folder ?? "";
  const claude = f.indexOf("/.claude/worktrees/");
  if (claude !== -1) return all.find((p) => p !== s && p.folder === f.slice(0, claude));
  const herdr = `${home()}/.herdr/worktrees/`;
  if (f.startsWith(herdr)) {
    const repo = f.slice(herdr.length).split("/")[0];
    return all.find((p) => p !== s && !p.folder.startsWith(herdr) && p.folder.split("/").pop() === repo);
  }
  return null;
}

export default class SpaceJump extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = null;
    this.start = 0;
    this.visible = MAX_ROWS;
    this.input = InputState.new({ placeholder: "Go to a space…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.start = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const all = spaces();
    const parent = new Map(all.map((s) => [s.id, parentOf(s, all)]));
    // The number alt-N and ctrl-N go to (the go-space-N mods): position among non-worktrees.
    const number = new Map(all.filter((s) => !isWorktree(s)).map((s, i) => [s.id, i + 1]));
    const out = [];
    for (const s of all) {
      if (parent.get(s.id)) continue;
      out.push({ s, tree: false, n: number.get(s.id) });
      for (const w of all) if (parent.get(w.id) === s) out.push({ s: w, tree: true });
    }
    const f = this.filter.toLowerCase();
    if (!f) return out;
    return out.filter(({ s }) => [s.name, s.folder, s.branch ?? "", s.machine ?? ""].join(" ").toLowerCase().includes(f));
  }

  go(r) {
    if (!r) return;
    this.close();
    run("space.select", { id: r.s.id });
  }

  glyph(t, st) {
    if (st === "working") return svg("mods/workspace-chrome/spinner.svg").size(12).flex_none().text_color(t.working).spin(900);
    return div().w(12).flex_none().text_color(t[st] ?? t.dim).child(st === "idle" ? "○" : st ? "●" : "·");
  }

  render() {
    const t = theme();
    const rows = this.rows();
    if (this.at === null) this.at = Math.max(0, rows.findIndex((r) => r.s.active));
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    // Keep the selection inside the shown window of rows.
    if (this.at < this.start) this.start = this.at;
    if (this.at >= this.start + this.visible) this.start = this.at - this.visible + 1;
    this.start = Math.max(0, Math.min(this.start, Math.max(0, rows.length - this.visible)));
    const shown = rows.slice(this.start, this.start + this.visible);

    const row = (r, i) => {
      const { s, tree } = r;
      const on = i === this.at;
      return h_flex()
        .id(`sj-${s.id}`)
        .h(ROW)
        .flex_none()
        .mx(4)
        .px(10)
        .gap(10)
        .rounded(7)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((el) => el.bg(t.hover))
        .on_click(() => this.go(r))
        .child(div().w(18).flex_none().text_size(11).text_color(t.dim).child(r.n ? String(r.n) : ""))
        .when(tree, (el) => el.child(svg("mods/workspace-chrome/branch.svg").size(12).flex_none().text_color(t.dim)))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(s.name))
        .when(Boolean(s.branch), (el) => el.child(div().max_w(160).truncate().text_size(11).text_color(t.dim).child(s.branch)))
        .when(s.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(s.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .child(this.glyph(t, s.status));
    };

    return v_flex()
      .id("space-jump")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        if (e.key === "escape") return this.close();
        if (!rows.length) return;
        if (e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).text_color(t.foreground).child("Spaces")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("sj-list")
          .h(Math.max(1, Math.min(MAX_ROWS, rows.length)) * ROW)
          .flex_none()
          .overflow_hidden()
          .on_scroll_wheel((e, cx) => {
            const step = e.delta.y > 0 ? -1 : e.delta.y < 0 ? 1 : 0;
            this.start = Math.max(0, Math.min(this.start + step, Math.max(0, rows.length - this.visible)));
            this.at = Math.max(this.start, Math.min(this.at, this.start + this.visible - 1));
            cx.notify();
          })
          .when(!rows.length, (el) => el.child(div().px(14).py(8).text_color(t.dim).child("No space matches")))
          .children(shown.map((r, k) => row(r, this.start + k))),
      );
  }
}
