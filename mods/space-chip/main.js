// The shown space's avatar and name, left of the tabs. my-status shows this
// block only while the sidebar is hidden; the avatar matches the sidebar's.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, theme, shared, run } from "herdr";

// Copied from the spaces mod: how a stored colour name looks on an avatar.
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export default class SpaceChip extends View {
  render() {
    const t = theme();
    const s = spaces().find((x) => x.active);
    if (!s) return div();
    const color = (shared("space.colors") ?? {})[s.id] ?? "ansi6";
    const fill = color.startsWith("#") ? color : (MARK[color] ?? t[color]);
    // The block is as wide as the name needs, within reason.
    const px = Math.min(240, 70 + [...s.name].length * 9);
    if (this.px !== px) { this.px = px; run("layout.resize", { id: "space-chip", px }); }
    return h_flex().size_full().pl(12).pr(8).gap(8).items_center().bg(t.chrome).border_b(1).border_color(t.border)
      .child(h_flex().size(20).flex_none().rounded(5).bg(fill).items_center().justify_center()
        .text_size(11).font_bold().text_color("#ffffff").child([...s.name][0]?.toUpperCase() ?? "?"))
      .child(div().flex_1().min_w(0).truncate().text_size(13.5).font_semibold().text_color(t.foreground).child(s.name))
      .child(div().w(1).h(18).flex_none().bg(t.border));
  }
}
