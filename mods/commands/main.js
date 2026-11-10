// Our own command palette: only the commands in commands.js, each with its
// key from keys.json. Type to filter, ↑/↓ and Enter to run, Esc to leave.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, theme, props, closeOverlay, keys, commands } from "herdr";
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
    this.input.on("submit", () => this.go(this.rows()[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.handle = cx.focus_handle();
  }

  close() {
    closeOverlay(props().overlay);
  }

  rows() {
    const f = this.filter.toLowerCase();
    return COMMANDS.filter((c) => !f || `${c.title} ${c.words ?? ""}`.toLowerCase().includes(f));
  }

  go(c) {
    if (!c) return;
    this.close();
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
        .on_click(() => this.go(c))
        .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(c.title))
        .child(div().text_size(11).text_color(t.dim).child(keyOf(c.action)));

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
        if (e.key === "down") this.at = (this.at + 1) % rows.length;
        else if (e.key === "up") this.at = (this.at + rows.length - 1) % rows.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).text_color(t.foreground).child("Commands")).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("cmd-list")
          .h(Math.max(1, Math.min(MAX_ROWS, rows.length)) * ROW)
          .flex_none()
          .overflow_hidden()
          .when(!rows.length, (el) => el.child(div().px(14).py(8).text_color(t.dim).child("No command matches")))
          .children(shown.map((c, k) => row(c, this.start + k))),
      );
  }
}
