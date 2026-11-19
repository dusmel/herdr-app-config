// The atlas chip, right of the status bar: "◆ 2 doing · 3 done today · 2 docs" for
// the focused agent's repo. It owns all atlas data and publishes it as shared
// "atlas" (todos), "atlas.docs" (this session's docs) and "atlas.timeline" (its effort's
// timeline, loaded ahead so the panel's Timeline tab opens at once); atlas-pop and atlas-panel
// only read them and ask for a refresh with shared "atlas.want". Hidden (0 px)
// unless the focused pane is an agent in a repo with an atlas link, or in the atlas
// tree. Budget: herdr-app/plan.html#budget.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { focused, layout, spaces, theme, settings, shared, setShared, run, openOverlay, exec, appHome, nextCommand } from "herdr";
import { repoOf, listTodos, today, cut, sessionOf, sessionList, sessionTodos, getTodo, rankTodos, listGroups, groupTodos, effortGroups, mix, popRows, setScope, byStatus, SCOPES, effortFor } from "./api.js";

const EMPTY = { applies: false };

export default class AtlasChip extends View {
  init(_props, cx) {
    this.key = null; // agent | folder last resolved
    this.want = 0; // last refresh request seen
    this.px = null;
    this.loading = 0; // start time of the load in flight
    this.finding = false;
    this.bounds = null; // the chip, in window coordinates, for placing the popup
    cx.timer.every(60000, (cx) => {
      if (!shared("atlas")?.applies) return;
      this.load(cx);
      this.timeline(cx);
      const d = shared("atlas.docs");
      if (d?.key === this.key) cx.spawn(() => this.mine(this.key, d.session, d.todos ?? [], false).catch(() => null));
    });
    // atlas-chip.open (cmd-shift-a) and atlas-chip.scope (the next view: session, repo, all).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const s = shared("atlas");
        if (c === "open") this.panel();
        else if (c === "scope" && s?.applies) { const i = SCOPES.findIndex(([k]) => k === s.scope); setScope(SCOPES[(i + 1) % SCOPES.length][0]); }
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
    if (moved) { setShared("atlas.docs", null); setShared("atlas.mine", null); }
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
        setShared("atlas", { applies: true, repo, agent: f.agent, terminal: f.terminal, pane: f.pane, folder, scope: shared("atlas.scope") ?? "session", todos: old?.repo?.dir === repo.dir ? old.todos : null });
      this.load(cx);
      this.docs(cx, key, f.terminal, folder, repo);
     } catch (e) { setShared("atlas", { applies: false, error: String(e?.message ?? e) }); }
    });
  }

  load(cx) {
    // One load at a time; a request made meanwhile (a scope switch) runs right after it.
    // A load older than 15 s is treated as lost, so one hung request can't stop the rest.
    if (this.loading && Date.now() - this.loading < 15000) { this.again = true; return; }
    this.again = false;
    const mine = this.loading = Date.now();
    cx.spawn(async (cx) => {
      try {
        const s = shared("atlas");
        if (!s?.applies) return;
        // The session view needs no request: mine() fills it. Until the session has todos,
        // it shows the folder's repo, with a note saying so.
        const m = shared("atlas.mine");
        if (s.scope === "session" && m?.key === this.key && m.list.length) return this.session(m.list);
        const name = s.scope === "all" ? null : s.repo?.id ?? s.repo?.name;
        const view = s.scope === "all" ? "all" : s.scope === "session" ? "fallback" : "repo";
        const [open, done] = await Promise.all([listTodos(name, "todo,doing"), listTodos(name, "done")]);
        const now = shared("atlas");
        if (now?.repo?.dir !== s.repo?.dir || now?.scope !== s.scope) return;
        if (now.view === "session") return;
        const slim = (t) => ({ id: t.id, title: cut((t.title ?? "").replace(/\*\*/g, "")), status: t.status, priority: t.priority, group: t.group_name, repo: t.repo_name, rank: t.rank, updated: t.updated_at, done: t.done_at, created: t.created_at });
        const doing = open.filter((t) => t.status === "doing").map(slim);
        const next = open.filter((t) => t.status === "todo").map(slim);
        const finished = done.map(slim).sort((a, b) => (b.done ?? "").localeCompare(a.done ?? ""));
        setShared("atlas", { ...now, view, todos: { doing, next, done: finished, doneToday: finished.filter((t) => today(t.done)).length }, error: null, loaded: Date.now() });
      } catch (e) {
        const now = shared("atlas");
        if (now?.applies) setShared("atlas", { ...now, error: String(e?.message ?? e) });
      } finally {
        if (this.loading === mine) { this.loading = 0; if (this.again) this.load(cx); }
      }
    });
  }

  // The session's effort timeline as shared "atlas.timeline", keyed like the panel's own load.
  // Finding the effort takes 1 or 2 requests before its entries, about 0.5 s each, so it is
  // fetched here ahead of time. A refresh asks for the effort it found last time: one request.
  timeline(cx) {
    const s = shared("atlas");
    if (!s?.applies) return;
    const session = shared("atlas.docs")?.session ?? null;
    const key = `${session}|${s.repo?.id ?? ""}`;
    const old = shared("atlas.timeline");
    if (this.tlKey === key || (old?.key === key && Date.now() - old.at < 50000)) return;
    this.tlKey = key;
    // The effort picked in the panel for this session (shared "atlas.timeline.pick"), else the last one,
    // but only once its choices are known: a copy without them takes the full lookup.
    const known = shared("atlas.timeline.pick")?.[session] ?? (old?.key === key && old.data?.choices ? old.data.group?.id : null);
    cx.spawn(async () => {
      try {
        const data = await effortFor(session, s.repo, known);
        if (!data.choices && old?.key === key) data.choices = old.data?.choices;
        setShared("atlas.timeline", { key, at: Date.now(), data });
      }
      catch {}
      finally { if (this.tlKey === key) this.tlKey = null; }
    });
  }

  // The session view's lists, from the session's ranked todos.
  session(list) {
    const s = shared("atlas");
    if (s?.applies && s.scope === "session") setShared("atlas", { ...s, view: "session", todos: byStatus(list), error: null, loaded: Date.now() });
  }

  // This session's todos as shared "atlas.mine": what the server says the session changed,
  // plus what the conversation shows it working on (from before the server kept sessions).
  // Conversation-only todos are fetched one by one, on events only (`fresh`); the timer
  // reuses them and asks the server for its list alone.
  async mine(key, session, named, fresh) {
    this.cache ??= new Map();
    const tagged = session ? await sessionTodos(session).catch(() => []) : [];
    // A server without the session filter returns every open todo, with no session_at.
    const ours = tagged.filter((t) => t.session_at);
    const seen = new Set(ours.map((t) => t.id));
    if (fresh) {
      const missing = named.filter((n) => !seen.has(n.id));
      const items = await Promise.all(missing.map((n) => getTodo(n.id).catch(() => null)));
      for (const it of items) if (it) this.cache.set(it.id, it);
    }
    const slim = (t, last, count) => ({ id: t.id, title: cut((t.title ?? "").replace(/\*\*/g, "")), status: t.status, priority: t.priority, group: t.group_name, repo: t.repo_name, rank: t.rank, updated: t.updated_at, done: t.done_at, last, count });
    const byId = new Map(named.map((n) => [n.id, n]));
    const list = [
      ...ours.map((t) => slim(t, Math.max(Date.parse(t.session_at), byId.get(t.id)?.last ?? 0), (byId.get(t.id)?.count ?? 0) + 1)),
      ...named.filter((n) => !seen.has(n.id) && this.cache.has(n.id)).map((n) => slim(this.cache.get(n.id), n.last, n.count)),
    ].filter((t) => !this.cache.get(t.id)?.archived_at);
    // Open todos of the efforts the session changed docs in, faded, below the session's own
    // open todos. The group list is fetched at most every 10 minutes.
    const d = shared("atlas.docs");
    if (fresh && Date.now() - (this.groups?.at ?? 0) > 600000) this.groups = { at: Date.now(), list: await listGroups().catch(() => this.groups?.list ?? []) };
    const efforts = d?.key === key ? effortGroups(this.groups?.list ?? [], d.list) : [];
    const own = new Set(list.map((t) => t.id));
    const more = (await Promise.all(efforts.map((g) => groupTodos(g.repo_name, g.name).catch(() => []))))
      .flat().filter((t) => !own.has(t.id) && own.add(t.id)).slice(0, 8)
      .map((t) => ({ ...slim(t, Date.parse(t.updated_at), 0), effort: true, faded: true, score: t.status === "doing" ? 0.95 : 0.9 }));
    // Open before done: what is left to do outranks what the session already finished.
    const ranked = [...rankTodos(list), ...more].sort((a, b) => (a.status === "done") - (b.status === "done") || b.score - a.score || (b.last ?? 0) - (a.last ?? 0));
    if (key !== this.key) return;
    setShared("atlas.mine", { key, list: ranked });
    if (ranked.length) this.session(ranked);
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
        if (key !== this.key) return;
        const { docs, todos } = sessionList(r.stdout, repo);
        setShared("atlas.docs", { key, start: sess?.start ?? midnight, session: sess?.id ?? null, list: docs, todos });
        this.timeline(cx);
        await this.mine(key, sess?.id, todos, true);
      } catch {
      } finally {
        this.finding = false;
      }
    });
  }

  // What the chip shows (chip-options.html#chip2, K5 + K6): Doing as a badge on the icon,
  // a bar of Doing, Next and Done, then the docs count.
  counts(s) {
    const t = s.todos;
    if (!t) return null;
    const d = shared("atlas.docs");
    const docs = d?.key === this.key ? d.list.filter((x) => x.changed).length : 0;
    // In the session view Next and Done are the session's own; elsewhere they are a backlog.
    const session = s.view === "session";
    return { doing: t.doing.length, next: session ? t.next.length : 0, done: session ? t.done.length : t.doneToday, docs };
  }

  // Opens just above the chip, right edges aligned. Its height follows atlas-pop's rows.
  popup() {
    if (shared("atlas.pop") || !this.bounds) return;
    setShared("atlas.want", Date.now());
    // The same rows atlas-pop draws (popRows), at 29 px each plus 24 per heading.
    const r = popRows(shared("atlas"), shared("atlas.mine"), shared("atlas.docs"), this.key);
    const block = (n) => (n ? 24 + n * 29 : 0);
    const body = block(r.doing.length) + block(r.next.length) + block(r.docs.length) + (r.summary ? 28 : 0) + (r.note ? 24 : 0);
    const height = Math.min(560, 12 + 28 + Math.max(body, 34));
    const b = this.bounds, width = 460;
    const at = { x: Math.max(8, b.x + b.width - width), y: Math.max(8, b.y - height - 4) };
    setShared("atlas.pop", openOverlay({ mod: "atlas-pop", kind: "popup", at, width, height }));
  }

  // Accent while something is in progress, dim when nothing is. Stale: a refresh failed,
  // or the last good one is over 3 minutes old; orange then, turning red by 15 minutes.
  tone(s, t) {
    const age = s.loaded ? Date.now() - s.loaded : 0;
    if (s.error || age > 180000) {
      const orange = mix(t.ansi3, t.ansi1, 0.45);
      return mix(orange, t.ansi1, Math.max(0, Math.min(1, (age - 180000) / 720000)));
    }
    const d = shared("atlas.docs");
    return s.todos?.doing.length || (d?.key === this.key && d.list.some((x) => x.changed)) ? t.accent : t.dim;
  }

  // The right panel on its atlas page; closes it when that page is already showing.
  panel() {
    const find = (n, id) => n?.id === id ? n : (n?.children ?? []).reduce((f, c) => f ?? find(c, id), null);
    const root = layout();
    if (!find(root, "panel")?.hidden && find(root, "panel-body")?.active === "atlas") return run("layout.hide", { id: "panel" });
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
    // The block takes the width the content measured (on_size_change), plus the padding.
    const px = s.applies ? Math.ceil((this.w ?? 60) + 14) : 0;
    if (this.px !== px) { this.px = px; run("layout.resize", { id: "atlas-chip", px }); }
    if (!s.applies) return div();
    const tone = this.tone(s, t);
    const c = this.counts(s);
    const total = c ? c.doing + c.next + c.done : 0;
        // The track doesn't clip its children to its corners, so the end parts round themselves.
    const parts = [[c?.doing, t.foreground], [c?.next, t.muted], [c?.done, t.accent]].filter(([n]) => n > 0);
    const part = ([n, color], i) => div().h_full().flex_none().w(Math.max(3, Math.round(56 * n / total))).bg(color)
      .when(i === 0, (el) => el.rounded_tl(2).rounded_bl(2)).when(i === parts.length - 1, (el) => el.rounded_tr(2).rounded_br(2));
    return h_flex().id("atlas-chip").size_full().pr(14).items_center().justify_end().text_size(11.8).cursor_pointer()
      .bg(t.chrome).border_t(1).border_color(t.border).text_color(t.muted).hover((el) => el.text_color(t.foreground))
      .on_mouse_move((e) => { this.bounds = e.bounds; this.popup(); })
      .on_click(() => this.panel())
      .child(h_flex().flex_none().gap(8).items_center()
        .on_size_change((size, cx) => { const w = size.width / (settings().zoom ?? 1); if (Math.abs(w - (this.w ?? 0)) > 0.5) { this.w = w; cx.notify(); } })
        .child(div().w(1).h(14).mr(4).flex_none().bg(t.border))
        .child(div().relative().flex_none().mr(c?.doing ? 6 : 0)
          .child(svg("mods/atlas-chip/atlas.svg").size(14).text_color(tone))
          .when(Boolean(c?.doing), (el) => el.child(div().absolute().top(-6).right(-9).h(13).px(4).rounded_full().bg(tone)
            .text_size(9).font_bold().text_color(t.chrome).flex().items_center().child(String(c.doing)))))
        .when(!c, (el) => el.when(Boolean(s.error), (el) => el.child(div().child("atlas offline"))))
        .when(total > 0, (el) => el.child(h_flex().h(4).gap(1).children(parts.map(part))))
        .when(total > 0 && Boolean(c?.docs), (el) => el.child(div().child("·")))
        .when(Boolean(c?.docs), (el) => el.child(h_flex().gap(4).child(div().text_color(tone).child(String(c.docs))).child(div().child(c.docs > 1 ? "docs" : "doc")))));
  }
}
