import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, agents, theme, run, window, keys, focused, shared, setShared, layout, updates, appHome, readTextFile, watchFolder, notify } from "herdr";

export default class WorkspaceStatus extends View {
  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  // Remembers the last two focused panes for pane-back (alt-tab). This bar is
  // always on screen, so it sees every focus change.
  track() {
    const f = focused();
    if (!f?.pane) return;
    const cur = shared("pane.cur");
    if (cur?.pane === f.pane) return;
    if (cur) setShared("pane.prev", cur);
    setShared("pane.cur", { space: f.space, tab: f.tab, pane: f.pane });
  }

  // The space chip stands in for the sidebar while it is hidden.
  chip() {
    const find = (n, id) => n?.id === id ? n : (n?.children ?? []).reduce((f, c) => f ?? find(c, id), null);
    const root = layout();
    const want = Boolean(find(root, "sidebar")?.hidden);
    const chip = find(root, "space-chip");
    if (chip && !chip.hidden !== want) run(want ? "layout.show" : "layout.hide", { id: "space-chip" });
  }

  // What the setup check still owes: after an install until `reclone done`, or
  // for a downloaded update until `reclone prechecked`. Null when nothing is owed.
  owed() {
    const u = updates().app;
    if (this.checked === undefined) return null;
    if (this.checked !== u.version) return { key: u.version, pill: `herdr-app ${u.version}: check my setup`,
      title: `herdr-app ${u.version}: check your setup`, body: "Our copies of stock mods don't get updates. An agent can redo them and suggest changes." };
    if (u.ready && this.prechecked !== u.ready) return { key: `pre-${u.ready}`, pill: `herdr-app ${u.ready} ready: check before restart`,
      title: `herdr-app ${u.ready} is ready: check before restarting`, body: "An agent reads its release notes against our setup and says what will need redoing." };
    return null;
  }

  // A pill here and one toast per version, both opening setup-check.
  // custom/CHECK.md is what the agent follows.
  init(_props, cx) {
    const dir = `${appHome()}/custom`;
    const load = async () => {
      this.checked = ((await readTextFile(`${dir}/checked`)) ?? "").trim();
      this.prechecked = ((await readTextFile(`${dir}/prechecked`)) ?? "").trim();
      const o = this.owed();
      if (o && shared("setup.notified") !== o.key) {
        setShared("setup.notified", o.key);
        notify({ title: o.title, body: o.body, level: "warning", action: { name: "mod.open", args: { name: "setup-check" } } });
      }
      cx.notify();
    };
    cx.spawn(async () => { await load(); for (;;) { await watchFolder(dir); await load(); } });
  }

  render() {
    this.track();
    this.chip();
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const owed = this.owed();
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .when(Boolean(owed), el => el.child(
        div().id("setup-check").px(8).h(18).flex().items_center().rounded(5).bg(t.accent).text_color(t.chrome).font_semibold()
          .on_click(() => run("mod.open", { name: "setup-check" })).child(owed.pill)))
      .child(div().flex_1())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
