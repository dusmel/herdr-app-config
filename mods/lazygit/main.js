// lazygit in a popup over the window, in the focused terminal's folder.
// Opened by `mod.open:lazygit`; this copy only launches it, then closes.
// The terminal overlay closes itself when lazygit quits.

import { View, div } from "gpui-kit";
import { hc, focused, home, props, openOverlay, closeOverlay, notify } from "herdr";

export default class Lazygit extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    // `herdr-app check` runs init without an overlay; don't launch then.
    if (!overlay) return;
    cx.spawn(async () => {
      const cwd = focused()?.cwd || home();
      const r = await hc(["run", "--bg", "--json", "--rm", "--no-parent", "--cwd", cwd, "lazygit"]);
      if (overlay) closeOverlay(overlay);
      let address = null;
      try {
        address = JSON.parse(r.stdout).address;
      } catch {}
      if (!address) {
        notify({ title: "lazygit didn't start", body: (r.stderr || r.stdout).trim(), level: "error" });
        return;
      }
      openOverlay({ kind: "dialog", width: 0.9, height: 0.9, layout: { type: "block", content: { terminal: address } } });
    });
  }

  render() {
    return div();
  }
}
