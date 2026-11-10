// Toggles between layouts/mine.json and layouts/zen.json: the same layout with the
// sidebar, tab bar and right panel hidden.
import { View, div } from "gpui-kit";
import { props, closeOverlay, run, shared } from "herdr";

export default class Zen extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    if (shared("layout") === "zen") return run("layout.switch", { name: "mine" });
    run("layout.switch", { name: "zen" });
    // Toggles made inside Zen are remembered; start it bare each time.
    for (const id of ["sidebar", "tabs", "panel"]) run("layout.hide", { id });
  }
  render() { return div(); }
}
