// The atlas chip, right of the status bar: "◆ 2 doing · 3 done today · 2 docs" for
// the focused agent's repo. It owns all atlas data and publishes it as shared
// "atlas" (todos) and "atlas.docs" (this session's docs); atlas-pop and atlas-panel
// only read them and ask for a refresh with shared "atlas.want". Hidden (0 px)
// unless the focused pane is an agent in a repo with an atlas link, or in the atlas
// tree. Budget: herdr-app/plan.html#budget.
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, spaces, theme, shared, setShared, run, openOverlay, exec, appHome, nextCommand } from "herdr";
import { repoOf, listTodos, today, cut, sessionOf, docList } from "./api.js";

const EMPTY = { applies: false };

export default class AtlasChip extends View {
  init(_props, cx) {
    this.key = null; // agent | folder last resolved
    this.want = 0; // last refresh request seen
    this.px = null;
    this.loading = false;
    this.finding = false;
    cx.timer.every(60000, (cx) => { if (shared("atlas")?.applies) this.load(cx); });
    // atlas-chip.open (cmd-shift-a) and atlas-chip.scope (this repo or all repos).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const s = shared("atlas");
        if (c === "open") this.panel();
        else if (c === "scope" && s?.applies) { setShared("atlas", { ...s, scope: s.scope === "all" ? "repo" : "all", todos: null }); setShared("atlas.want", Date.now()); }
      }
    });
  }

  // Cheap, every render: has the focused agent or its folder changed?
  check(cx) {
    const f = focused();
    // The agent's own folder first, then its space's (grilling: either one tracked).
    const space = f?.agent ? spaces().find((s) => s.id === f.space)?.folder : null;
    const folder = f?.agent ? f.cwd ?? space : null;
    const key = f?.agent && folder ? `${f.agent}|${folder}|${space}` : null;
    const want = shared("atlas.want") ?? 0;
    if (key === this.key && want === this.want) return;
    const moved = key !== this.key;
    if (moved) setShared("atlas.docs", null);
    this.key = key;
    this.want = want;
    if (!key) { if (shared("atlas")?.applies) setShared("atlas", EMPTY); return; }
    cx.spawn(async (cx) => {
     try {
      const repo = (await repoOf(folder)) ?? (space && space !== folder ? await repoOf(space) : null);
      if (key !== this.key) return;
      if (!repo) { setShared("atlas", EMPTY); return; }
      const old = shared("atlas");
      if (moved || !old?.applies || old.repo?.dir !== repo.dir)
        setShared("atlas", { applies: true, repo, agent: f.agent, terminal: f.terminal, pane: f.pane, folder, scope: old?.scope ?? "repo", todos: old?.repo?.dir === repo.dir ? old.todos : null });
      this.load(cx);
      this.docs(cx, key, f.terminal, folder, repo);
     } catch (e) { setShared("atlas", { applies: false, error: String(e?.message ?? e) }); }
    });
  }

  load(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const s = shared("atlas");
        if (!s?.applies) return;
        const name = s.scope === "all" ? null : s.repo?.id ?? s.repo?.name;
        const [open, done] = await Promise.all([listTodos(name, "todo,doing"), listTodos(name, "done")]);
        const now = shared("atlas");
        if (now?.repo?.dir !== s.repo?.dir || now?.scope !== s.scope) return;
        const slim = (t) => ({ id: t.id, title: cut((t.title ?? "").replace(/\*\*/g, "")), status: t.status, priority: t.priority, group: t.group_name, repo: t.repo_name, rank: t.rank, updated: t.updated_at, done: t.done_at, created: t.created_at });
        const doing = open.filter((t) => t.status === "doing").map(slim);
        const next = open.filter((t) => t.status === "todo").map(slim);
        const finished = done.map(slim).sort((a, b) => (b.done ?? "").localeCompare(a.done ?? ""));
        setShared("atlas", { ...now, todos: { doing, next, done: finished, doneToday: finished.filter((t) => today(t.done)).length }, error: null, loaded: Date.now() });
      } catch (e) {
        const now = shared("atlas");
        if (now?.applies) setShared("atlas", { ...now, error: String(e?.message ?? e) });
      } finally {
        this.loading = false;
      }
    });
  }

  // This session's docs (design.html#docs): docs.sh reads only the conversation's
  // new bytes, so a repeat costs about 0.1 s. Runs on events, never on the timer.
  docs(cx, key, terminal, folder, repo) {
    if (this.finding) return;
    this.finding = true;
    cx.spawn(async (cx) => {
      try {
        const sess = await sessionOf(terminal);
        const midnight = new Date().setHours(0, 0, 0, 0);
        const args = [`${appHome()}/mods/atlas-chip/docs.sh`, sess?.transcript ?? "-", String(Math.floor((sess?.start ?? midnight) / 1000)), sess?.cwd ?? folder, repo.name ? repo.dir : "-"];
        const r = await exec("/bin/bash", args, { timeout: 30000 });
        if (key === this.key) setShared("atlas.docs", { key, start: sess?.start ?? midnight, list: docList(r.stdout, repo) });
      } catch {
      } finally {
        this.finding = false;
      }
    });
  }

  text(s) {
    const t = s.todos;
    if (!t) return s.error ? "atlas offline" : "";
    const d = shared("atlas.docs");
    const docs = d?.key === this.key ? d.list.length : 0;
    return [t.doing.length && `${t.doing.length} doing`, t.doneToday && `${t.doneToday} done today`, docs && `${docs} doc${docs > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  }

  popup() {
    if (shared("atlas.pop")) return;
    setShared("atlas.want", Date.now());
    setShared("atlas.pop", openOverlay({ mod: "atlas-pop", kind: "popup", at: "pointer", width: 380 }));
  }

  // The right panel on its atlas page.
  panel() {
    setShared("atlas.want", Date.now());
    run("layout.show", { id: "panel" });
    run("layout.select", { stack: "panel-body", child: "atlas" });
    // The panel is the rightmost focusable block (mod.json focusable), so this gives it
    // the keyboard unless another pane sits right of the agent.
    run("pane.go", { direction: "right" });
  }

  render(cx) {
    this.check(cx);
    const t = theme();
    const s = shared("atlas") ?? EMPTY;
    const label = s.applies ? this.text(s) : "";
    const px = s.applies ? 34 + label.length * 7.2 : 0;
    if (this.px !== px) { this.px = px; run("layout.resize", { id: "atlas-chip", px }); }
    if (!s.applies) return div();
    return h_flex().id("atlas-chip").size_full().pl(4).pr(14).gap(6).items_center().justify_end().text_size(11.8).cursor_pointer()
      .bg(t.chrome).border_t(1).border_color(t.border).text_color(t.muted).hover((el) => el.text_color(t.foreground))
      .on_hover((on) => { if (on) this.popup(); })
      .on_click(() => this.panel())
      .child(div().text_color(s.error ? t.dim : t.accent).child("◆"))
      .when(Boolean(label), (el) => el.child(label));
  }
}
