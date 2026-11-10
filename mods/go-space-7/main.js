// alt-7 / ctrl-7: the 7th space that isn't a worktree, so worktrees don't
// shift the numbers. Opened as an overlay only to run; mods can't share files.
import { View, div } from "gpui-kit";
import { spaces, home, props, closeOverlay, run } from "herdr";

const isWorktree = (s) => (s.folder ?? "").includes("/.claude/worktrees/") || (s.folder ?? "").startsWith(`${home()}/.herdr/worktrees/`);

export default class GoSpace extends View {
  init() {
    const overlay = props()?.overlay;
    if (!overlay) return;
    closeOverlay(overlay);
    const s = spaces().filter((s) => !isWorktree(s))[7 - 1];
    if (s) run("space.select", { id: s.id });
  }

  render() {
    return div();
  }
}
