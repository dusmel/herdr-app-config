// Dims the sidebar's space avatars by giving each space colour an alpha.
// New spaces get a bright colour; run `herdr-app do mod.open --name dim-avatars` again.
import { View, div } from "gpui-kit";
import { props, closeOverlay, shared, setShared } from "herdr";

// Same hex the spaces mod draws for each theme colour name.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const ALPHA = "33";

export default class DimAvatars extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    const colors = { ...(shared("space.colors") ?? {}) };
    for (const [id, c] of Object.entries(colors)) {
      // Replaces any earlier alpha, so changing ALPHA and re-running takes effect.
      const hex = c.startsWith("#") ? c.slice(0, 7) : MARK[c];
      if (hex) colors[id] = hex + ALPHA;
    }
    setShared("space.colors", colors);
  }
  render() { return div(); }
}
