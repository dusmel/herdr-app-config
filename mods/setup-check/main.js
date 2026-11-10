// Opens a Claude tab in the configs space that checks our setup against herdr-app,
// following custom/CHECK.md. Opened from my-status's pill or toast.
import { View, div } from "gpui-kit";
import { spaces, props, closeOverlay, run, updates, appHome, home, readTextFile, writeTextFile } from "herdr";

export default class SetupCheck extends View {
  init(_props, cx) {
    const overlay = props()?.overlay;
    if (!overlay) return;
    // The overlay closes last: closing it first could drop this view and its task.
    cx.spawn(async () => { await this.open(); closeOverlay(overlay); });
  }

  async open() {
    const dir = `${appHome()}/custom`;
    const u = updates();
    const checked = ((await readTextFile(`${dir}/checked`)) ?? "").trim();
    let task = `herdr-app was updated to ${u.app.version}. Read custom/CHECK.md and follow it.`;
    if (checked === u.app.version && u.app.ready) {
      // Before the restart: the new stock files don't exist yet, only the release notes do.
      const path = `${dir}/waiting-notes.json`;
      await writeTextFile(path, JSON.stringify({ installed: u.app.version, waiting: u.app.ready, notes: u.notes }, null, 2) + "\n", await readTextFile(path));
      task = `herdr-app ${u.app.ready} is downloaded but not installed. Read custom/CHECK.md, section "Before the restart", and follow it.`;
    }
    const space = spaces().find((s) => s.folder === `${home()}/.config`)?.id;
    // Through a login shell: herdr-core's PATH lacks ~/.local/bin, where claude lives.
    run("tab.new", { ...(space ? { space } : {}), name: "setup check", folder: appHome(),
      argv: ["/bin/zsh", "-lic", `claude '${task}'; exec /bin/zsh -l`] });
  }

  render() {
    return div();
  }
}
