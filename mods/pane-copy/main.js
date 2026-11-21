// opt-shift-c: copies the focused pane's terminal id (t3q), the one hc and agents address.
// Mods have no clipboard API, so it goes through pbcopy.
import { View, div } from "gpui-kit";
import { props, closeOverlay, focused, exec, notify } from "herdr";

export default class PaneCopy extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    if (!overlay) return;
    const id = focused()?.terminal;
    // Close only after the toast: once the popup closes, the mod stops and nothing after runs.
    cx.spawn(async () => {
      if (!id) notify({ title: "No terminal is focused", level: "warning", timeout: 2000 });
      else {
        await exec("/bin/sh", ["-c", 'printf %s "$1" | pbcopy', "sh", id]);
        notify({ title: `Copied ${id}`, level: "success", timeout: 2000 });
      }
      closeOverlay(overlay);
    });
  }

  render() {
    return div();
  }
}
