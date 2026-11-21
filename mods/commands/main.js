// Our own command palette: only the commands in commands.js, each with its
// key from keys.json. Type to filter, ↑/↓ and Enter to run, Esc to leave.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, props, closeOverlay, keys, commands, panes, spaces, shared, focused } from "herdr";
import COMMANDS from "./commands.js";

const ROW = 32;
const MAX_ROWS = 12;
const MAC = { cmd: "⌘", alt: "⌥", ctrl: "⌃", shift: "⇧" };

// "cmd:value" puts value in the command's first argument, as keys.json does.
function parse(action) {
  if (typeof action === "object") return { name: action.command, args: action.args ?? {} };
  const at = action.indexOf(":");
  if (at === -1) return { name: action, args: {} };
  const name = action.slice(0, at);
  const first = commands().find((c) => c.name === name)?.args[0]?.name;
  return { name, args: first ? { [first]: action.slice(at + 1) } : {} };
}

function keyOf(action) {
  if (typeof action !== "string") return "";
  const k = keys().find((b) => b.section === "global" && b.action === action);
  return k ? k.keys.split("-").map((p) => MAC[p] ?? p.toUpperCase()).join("") : "";
}

export default class Commands extends View {
  init(_props, cx) {
    this.filter = "";
    this.at = 0;
    this.start = 0;
    this.input = InputState.new({ placeholder: "Run a command…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; this.start = 0; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    // "Go to pane id…" swaps in this box: a placeholder can't change after creation.
    this.idInput = InputState.new({ placeholder: "Terminal id, like t3q" });
    this.idInput.on("change", (_e, cx) => { this.at = 0; this.start = 0; cx.notify(); });
    this.idInput.on("submit", (_e, cx) => this.go(this.rows()[this.at], cx));
    this.picking = false;
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    if (this.picking) return this.paneRows();
    const f = this.filter.toLowerCase();
    return COMMANDS.filter((c) => !f || `${c.title} ${c.words ?? ""}`.toLowerCase().includes(f));
  }

  // Panes whose terminal id starts with what was typed, in every space, most recently
  // focused first (my-status keeps pane.recent). The focused pane is left out.
  paneRows() {
    const f = this.idInput.value().trim().toLowerCase();
    const spaceOf = new Map(spaces().flatMap((s) => s.tabs.map((tab) => [tab.id, s])));
    const recent = shared("pane.recent") ?? [];
    const rank = (p) => { const i = recent.indexOf(p.pane); return i === -1 ? recent.length : i; };
    const here = focused()?.pane;
    return panes()
      .filter((p) => p.terminal && p.pane !== here && p.terminal.toLowerCase().startsWith(f))
      .sort((a, b) => rank(a) - rank(b))
      .map((p) => ({ title: p.terminal, note: `${spaceOf.get(p.tab)?.name ?? ""} · ${p.title}`, pane: p, space: spaceOf.get(p.tab)?.id }));
  }

  go(c, cx) {
    if (!c) return;
    if (c.pick) {
      this.picking = true;
      this.at = 0;
      this.start = 0;
      this.idInput.focus();
      return cx?.notify();
    }
    this.close();
    // Space, then tab, then the pane: the pane may be in another space.
    if (c.pane) {
      if (c.space) run("space.select", { id: c.space });
      run("tab.select", { id: c.pane.tab });
      return run("pane.focus", { pane: c.pane.pane });
    }
    if (typeof c.action === "function") return c.action();
    const { name, args } = parse(c.action);
    run(name, args);
  }

  render() {
    const t = theme();
    const rows = this.rows();
    this.at = Math.max(0, Math.min(this.at, rows.length - 1));
    if (this.at < this.start) this.start = this.at;
    if (this.at >= this.start + MAX_ROWS) this.start = this.at - MAX_ROWS + 1;
    const shown = rows.slice(this.start, this.start + MAX_ROWS);

    const row = (c, i) =>
      h_flex()
        .id(`cmd-${i}`)
        .h(ROW)
        .flex_none()
        .mx(4)
        .px(10)
        .gap(10)
        .rounded(7)
        .items_center()
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.hover))
        .hover((el) => el.bg(t.hover))
        .on_click((_e, cx) => this.go(c, cx))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.title))
        .child(div().max_w(360).truncate().text_size(11).text_color(t.dim).child(c.note ?? keyOf(c.action)));

    return v_flex()
      .id("commands")
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
        const back = e.key === "up" || (e.key === "tab" && e.modifiers?.shift);
        if (back) this.at = (this.at + rows.length - 1) % rows.length;
        else if (e.key === "down" || e.key === "tab") this.at = (this.at + 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).text_color(t.foreground).child(this.picking ? "Go to pane id" : "Commands")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.picking ? this.idInput : this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("cmd-list")
          .h(Math.max(1, Math.min(MAX_ROWS, rows.length)) * ROW)
          .flex_none()
          .overflow_hidden()
          .when(!rows.length, (el) => el.child(div().px(14).py(8).text_color(t.dim).child(this.picking ? "No pane has that id" : "No command matches")))
          .children(shown.map((c, k) => row(c, this.start + k))),
      );
  }
}
