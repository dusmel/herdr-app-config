// cmd-m: WezTerm's pane select. Each pane in the shown tab gets a letter in its
// header (my-pane draws it from shared pane.pick); press it to focus that pane.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { panes, focused, props, closeOverlay, run, theme, setShared } from "herdr";

const KEYS = "asdfghjklqwertyuiop";

export default class PanePick extends View {
  init(_props, cx) {
    const tab = focused()?.tab;
    this.list = panes().filter((p) => p.tab === tab);
    this.letters = Object.fromEntries(this.list.map((p, i) => [KEYS[i], p.pane]));
    setShared("pane.pick", Object.fromEntries(this.list.map((p, i) => [p.pane, KEYS[i]])));
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  close() {
    setShared("pane.pick", null);
    closeOverlay(props().overlay);
  }

  render() {
    const t = theme();
    return v_flex()
      .id("pane-pick")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const pane = this.letters[e.key];
        if (pane) { this.close(); run("pane.focus", { pane }); }
        else if (e.key === "escape") this.close();
        else return;
        cx.stop_propagation();
      })
      .w_full()
      .p(12)
      .gap(4)
      .bg(t.popover)
      .text_size(12)
      .text_color(t.dim)
      .child(div().text_color(t.foreground).child("Press a pane's letter"))
      .child(`${KEYS[0]}–${KEYS[Math.max(0, this.list.length - 1)]}, Esc to cancel`);
  }
}
