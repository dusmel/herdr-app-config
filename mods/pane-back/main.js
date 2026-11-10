// alt-tab: back to the pane focused before this one, in any space. my-status
// records the history; this only runs, so it opens as a tiny overlay and closes.
import { View, div } from "gpui-kit";
import { spaces, panes, shared, props, closeOverlay, run } from "herdr";

export default class PaneBack extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    const p = shared("pane.prev");
    if (!p || !spaces().some((s) => s.id === p.space)) return;
    run("space.select", { id: p.space });
    run("tab.select", { id: p.tab });
    if (panes().some((x) => x.pane === p.pane)) run("pane.focus", { pane: p.pane });
  }

  render() {
    return div();
  }
}
