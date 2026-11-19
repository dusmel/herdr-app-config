// Source: mods/atlas-chip/api.js. Mods cannot import across folders, so atlas-pop and atlas-panel hold copies; edit the source, then copy it.
// The Atlas server and repo lookup, shared by atlas-chip, atlas-pop and atlas-panel.
// The token comes from the atlas CLI's own config and stays in memory.
import * as fs from "fs/promises";
import { home, readTextFile, exec, shared, setShared } from "herdr";

export const ATLAS = () => `${home()}/MEGA/Documents/atlas`;

let conf = null;
async function config() {
  if (conf) return conf;
  const text = await readTextFile(`${home()}/.config/atlas/config.json`).catch(() => null);
  try { conf = JSON.parse(text ?? ""); } catch { conf = null; }
  return conf;
}

// `who`: the focused agent's {session, terminal}, stored on the event like the CLI's own.
let who = {};
export const actingFor = (w) => { who = w ?? {}; };

async function call(path, init = {}) {
  const c = await config();
  if (!c?.url || !c?.token) throw new Error("atlas config missing");
  const tags = { ...(who.session ? { "x-atlas-session": who.session } : {}), ...(who.terminal ? { "x-atlas-terminal": who.terminal } : {}) };
  // The mods' fetch takes only method, headers and body: no signal, so no timeout here.
  const r = await fetch(`${c.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${c.token}`, "x-atlas-author": "me", "x-atlas-device": c.device ?? "herdr-app", "content-type": "application/json", ...tags, ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? `atlas ${r.status}`);
  return r.json();
}

export const getTodo = (id) => call(`/api/todos/${id}`).then((r) => r.item);
// The todo with its events (newest first) and sub-todos, for the panel's expanded row.
export const todoDetail = (id) => call(`/api/todos/${id}`);
// The todo's page on the Atlas site, in the default browser.
export const openTodo = async (id) => { const c = await config(); if (c?.url) await exec("/usr/bin/open", [`${c.url}/todos?item=${id}`]).catch(() => null); };
// What one agent session changed (server side, from the events' session column).
export const sessionTodos = (session) => call(`/api/todos?status=todo,doing,done&session=${encodeURIComponent(session)}`);
export const listTodos = (repo, status) => call(`/api/todos?status=${status}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`);
export const updateTodo = (id, body) => call(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const moveTodo = (id, body) => call(`/api/todos/${id}/move`, { method: "POST", body: JSON.stringify(body) });
export const PERSONAL = { id: "_personal", name: "personal" };
export const repoRef = (repo) => (repo?.id ? { id: repo.id, name: repo.name } : repo?.name ?? PERSONAL);
export const listGroups = () => call(`/api/groups`);
export const groupTodos = (repo, group) => call(`/api/todos?status=todo,doing&repo=${encodeURIComponent(repo)}&group=${encodeURIComponent(group)}`);
export const addTodo = (body) => call(`/api/todos`, { method: "POST", body: JSON.stringify(body) });

// The timeline (atlas/repos/atlas/timeline/design.html): the effort a session works on, else
// the repo's latest, with its entries. { effort: null } when there is none. A server without
// the timeline answers a bare 404, which throws "atlas 404"; an unknown session is not_found.
// With `quick`, `known` (the effort found last time or the one picked) skips the lookup: one request
// instead of two or three, and the answer has no `choices`, so callers keep the ones they had.
// Without it, the full lookup still shows `known` when the session worked on it.
// `choices`: every effort the session worked on, best first, for picking another one; `choicesAt`: when.
export async function effortFor(session, repo, known = null, quick = true) {
  if (known && quick) { const v = await call(`/api/timeline?group=${known}`).catch(() => null); if (v?.group) return v; }
  let effort = null, choices = [];
  if (session) {
    const v = await call(`/api/timeline?session=${encodeURIComponent(session)}`).catch((e) => { if (e?.message === "atlas 404") throw e; return null; });
    const score = (e) => (e.repo_name === repo?.name ? 4 : 0) + (e.branches ? 2 : 0) + e.signals.length / 10;
    choices = (v?.session?.efforts ?? []).filter((e) => e.branches || e.signals.includes("adopted")).sort((a, b) => score(b) - score(a)).map(({ id, name, repo_name }) => ({ id, name, repo_name }));
    effort = choices.find((c) => c.id === known) ?? choices[0] ?? null;
  }
  if (!effort && repo?.id) {
    const list = await call(`/api/timeline`);
    effort = list.efforts.filter((e) => e.repo_id === repo.id).sort((a, b) => (b.last_at ?? "").localeCompare(a.last_at ?? ""))[0] ?? null;
  }
  const choicesAt = Date.now();
  return effort ? { ...(await call(`/api/timeline?group=${effort.id}`)), choices, choicesAt } : { effort: null, choices, choicesAt };
}

// A session gains efforts as it works (its links sync on Stop, every 10 minutes at most), so
// choices older than that take the full lookup again.
export const choicesFresh = (data) => Boolean(data?.choices) && Date.now() - (data.choicesAt ?? 0) < 600000;

// An answer to a quick lookup carries over the choices it did not fetch.
export function keepChoices(data, prev) {
  if (!data.choices && prev) { data.choices = prev.choices; data.choicesAt = prev.choicesAt; }
  return data;
}
export const openTimeline = async (group) => { const c = await config(); if (c?.url) await exec("/usr/bin/open", [`${c.url}/timeline?group=${group}`]).catch(() => null); };

// The atlas repo for a folder: inside the atlas tree, or a folder (or a parent,
// for worktrees) with an `atlas` link into it. Null when there is none.
const repos = new Map();
export async function repoOf(folder) {
  if (!folder) return null;
  if (repos.has(folder)) return repos.get(folder);
  const root = `${ATLAS()}/repos/`;
  let found = null;
  if (folder.startsWith(root)) {
    const name = folder.slice(root.length).split("/")[0];
    found = { name, dir: root + name };
  } else if (folder === ATLAS() || folder.startsWith(ATLAS() + "/")) {
    found = { name: null, dir: ATLAS() };
  } else {
    let dir = folder;
    for (let i = 0; i < 5 && dir && dir !== home() && dir !== "/"; i++) {
      // The mods' fs has no realpath or readlink: check, then ask readlink once (cached).
      const has = await fs.exists(`${dir}/atlas`).catch(() => false);
      const real = has ? (await exec("/usr/bin/readlink", ["-f", `${dir}/atlas`]).catch(() => null))?.stdout?.trim() : null;
      if (real?.startsWith(root)) { const name = real.slice(root.length).split("/")[0]; found = { name, dir: root + name }; break; }
      dir = dir.slice(0, dir.lastIndexOf("/"));
    }
  }
  // Writes name the repo by {id, name} from its meta.json, as the atlas CLI does.
  if (found?.name) {
    try { found.id = JSON.parse((await readTextFile(`${found.dir}/meta.json`)) ?? "").id ?? null; } catch {}
  }
  repos.set(folder, found);
  return found;
}

// The Claude session running in a terminal: { start (ms), cwd, transcript } or null.
// One `ps` maps every live session to its terminal (HC_TERMINAL_ID is in its env);
// a miss is retried after 5 minutes, so other agents don't cost a `ps` per event.
const terms = new Map(); // terminal -> pid, or { miss: time }
export async function sessionOf(terminal) {
  if (!terminal) return null;
  let pid = terms.get(terminal);
  if (pid === undefined || (pid?.miss && Date.now() - pid.miss > 300000)) {
    const dir = `${home()}/.claude/sessions`;
    const pids = (await fs.readdir(dir).catch(() => [])).filter((n) => /^\d+\.json$/.test(n)).map((n) => n.slice(0, -5));
    const out = pids.length ? (await exec("/bin/ps", ["-wwE", "-o", "pid=,command=", "-p", pids.join(",")]).catch(() => null))?.stdout ?? "" : "";
    const found = new Map();
    for (const line of out.split("\n")) {
      const m = line.match(/^\s*(\d+).*?HC_TERMINAL_ID=(\S+)/);
      if (m) (found.get(m[2]) ?? found.set(m[2], []).get(m[2])).push(m[1]);
    }
    for (const [t, list] of found) terms.set(t, list.length === 1 ? list[0] : list);
    if (!found.has(terminal)) terms.set(terminal, { miss: Date.now() });
    pid = terms.get(terminal);
  }
  if (pid?.miss) return null;
  // Two sessions can share a terminal for a moment; the newest one wins.
  let best = null;
  for (const p of [pid].flat()) {
    const text = await readTextFile(`${home()}/.claude/sessions/${p}.json`).catch(() => null);
    let s = null;
    try { s = JSON.parse(text ?? ""); } catch {}
    if (s?.sessionId && (!best || s.startedAt > best.startedAt)) best = s;
  }
  if (!best) { terms.delete(terminal); return null; }
  const transcript = `${home()}/.claude/projects/${best.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${best.sessionId}.jsonl`;
  const has = await fs.exists(transcript).catch(() => false);
  return { id: best.sessionId, start: (has && (await firstAt(transcript))) || best.startedAt, cwd: best.cwd, transcript: has ? transcript : null };
}

// A resumed session (`claude --resume`, or after a reboot) gets a new startedAt but keeps
// its conversation, so the session starts at the conversation's first timestamp.
const firsts = new Map();
async function firstAt(transcript) {
  if (!firsts.has(transcript)) {
    const head = (await exec("/usr/bin/head", ["-c", "20000", transcript]).catch(() => null))?.stdout ?? "";
    const m = head.match(/"timestamp":"([^"]+)"/);
    firsts.set(transcript, m ? Date.parse(m[1]) || null : null);
  }
  return firsts.get(transcript);
}

// Relevance (design.html#relevance): the last day counts most, then three days, then the
// week; older items drop out. Items past a day stay listed, faded.
const DAY = 86400000;
export function recency(ms) {
  const age = Date.now() - ms;
  return age < DAY ? 1 : age < 3 * DAY ? 0.5 : age < 7 * DAY ? 0.2 : -1;
}
const touches = (n) => Math.min(1, Math.log10(1 + n) / 1.5);

// docs.sh output as { docs, todos }. Docs: x.md and x.html share one row that opens the
// html; a doc the session changed outranks one it only named, plans and designs outrank
// other docs, then recency and how often the session touched it. At most 50.
export function sessionList(stdout, repo) {
  const rows = new Map();
  const todos = [];
  for (const line of stdout.split("\n")) {
    const f = line.split("\t");
    if (f[0] === "T") { todos.push({ id: Number(f[1]), last: Number(f[2]) * 1000, count: Number(f[3]) }); continue; }
    if ((f[0] !== "C" && f[0] !== "R") || !f[4]) continue;
    const [kind, m, last, count, path] = f;
    const stem = path.replace(/\.(md|html)$/, "");
    const row = rows.get(stem) ?? { stem, mtime: 0, last: 0, count: 0, open: path, changed: false };
    row.mtime = Math.max(row.mtime, Number(m) * 1000);
    row.last = Math.max(row.last, Number(last) * 1000);
    row.count += Number(count);
    row.changed ||= kind === "C";
    if (path.endsWith(".html")) row.open = path;
    rows.set(stem, row);
  }
  const docs = [...rows.values()]
    .map((r) => {
      // "atlas-mod/plan", tagged with its repo when that isn't the focused one.
      const rel = r.stem.slice(ATLAS().length + 1);
      const m = rel.match(/^repos\/([^/]+)\/(.*)$/);
      const where = m ? m[1] : "atlas";
      const effort = /\/(plan|design)$/.test(r.stem);
      const when = r.changed ? Math.max(r.mtime, r.last) : r.last;
      const rec = recency(when);
      return { ...r, when, name: (m ? m[2] : rel).split("/").slice(-2).join("/"), where: where === repo?.name ? null : where, effort,
        faded: rec < 1, score: rec < 0 ? -1 : (r.changed ? 2 : 0) + (effort ? 1 : 0) + rec + touches(r.count) };
    })
    .filter((r) => r.score >= 0)
    .sort((a, b) => b.score - a.score || b.when - a.when)
    .slice(0, 50);
  return { docs, todos: todos.filter((t) => recency(t.last) >= 0).sort((a, b) => b.last - a.last).slice(0, 12) };
}

// Session todos, most relevant first: open ones before done, then recency and touches.
export function rankTodos(list) {
  return list
    .map((t) => { const rec = recency(t.last); return { ...t, faded: rec < 1, score: rec < 0 ? -1 : (t.status === "doing" ? 1.5 : t.status === "todo" ? 1 : 0) + rec + touches(t.count ?? 1) }; })
    .filter((t) => t.score >= 0)
    .sort((a, b) => b.score - a.score || b.last - a.last);
}

// Groups whose linked doc sits in an effort folder (repos/<repo>/<folder>/..., never a
// repo's top level) holding a doc the session changed: their open todos are the session's too.
export function effortGroups(groups, docs) {
  const changed = docs.filter((d) => d.changed).map((d) => d.stem);
  const norm = (p) => p.split("/").reduce((a, x) => (x === ".." ? a.slice(0, -1) : x === "." ? a : [...a, x]), []).join("/");
  return groups.filter((g) => g.open > 0 && (g.docs ?? []).some((d) => {
    if (!d.path.includes("/")) return false;
    const dir = norm(`${ATLAS()}/repos/${g.repo_name}/${d.path}`).replace(/\/[^/]+$/, "");
    return dir.split("/").length > ATLAS().split("/").length + 2 && changed.some((s) => s.startsWith(`${dir}/`));
  }));
}

// The three views (design.html#scopes). "session": only this session's todos, by status,
// and its docs; "repo": the folder's repo; "all": every repo and personal.
export const SCOPES = [["session", "session"], ["repo", "repo"], ["all", "all"]];
export function setScope(scope) {
  const s = shared("atlas");
  if (!s?.applies || s.scope === scope) return;
  setShared("atlas.scope", scope); // kept apart from "atlas", which resets whenever focus leaves an agent
  setShared("atlas", { ...s, scope, todos: null, view: null });
  setShared("atlas.want", Date.now());
}

// The session's todos as the lists the views draw, in timeline order like the other views:
// Doing longest in progress first, Next by rank, Done newest first. Relevance only picks
// the todos and fades them.
export function byStatus(list) {
  // Ranks are fractional-index keys: byte order, not locale order.
  const by = (f) => (a, b) => (f(a) < f(b) ? -1 : f(a) > f(b) ? 1 : 0);
  // The board's order: Inbox, then P0 to P3, each lane by rank.
  const board = by((t) => `${t.priority ? `1${t.priority}` : "0"}|${t.rank ?? ""}`);
  const doing = list.filter((t) => t.status === "doing").sort(board);
  const next = list.filter((t) => t.status === "todo").sort(board);
  const done = list.filter((t) => t.status === "done").sort((a, b) => (b.done ?? "").localeCompare(a.done ?? ""));
  return { doing, next, done, doneToday: done.filter((t) => today(t.done)).length };
}

// "This session: 8 open · 10 done · 15 docs", for the repo and all views. Null when empty.
export function sessionSummary(mine, d, key) {
  const list = mine && mine.key === key ? mine.list : [];
  const docs = d && d.key === key ? d.list.filter((x) => x.changed).length : 0;
  const done = list.filter((t) => t.status === "done").length;
  const parts = [list.length - done && `${list.length - done} open`, done && `${done} done`, docs && `${docs} doc${docs > 1 ? "s" : ""}`].filter(Boolean);
  return parts.length ? `This session: ${parts.join(" · ")}` : null;
}

// "#rrggbb" a to b by f (0..1).
export function mix(a, b, f) {
  const p = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}/i.test(a ?? "") || !/^#[0-9a-f]{6}/i.test(b ?? "")) return f < 0.5 ? a : b;
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * f).toString(16).padStart(2, "0")).join("");
}

export const openDoc = (path) => exec("/opt/homebrew/bin/node", [`${home()}/.agents/skills/html-docs/open-doc.mjs`, path]).catch(() => null);

// "15:30" today, "yesterday", "3d", else the date.
export function ago(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}

export const today = (iso) => { const d = new Date(iso), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); };
export const cut = (s, n = 200) => (s ?? "").length > n ? `${s.slice(0, n - 1)}…` : (s ?? "");

// What the popup shows: this session's todos (4) and docs (4), then the scope's Doing (5)
// and Next (3) without the session's own. atlas-chip sizes the popup from the same rows.
export function popRows(s, mine, d, key) {
  const session = s?.view === "session";
  const t = s?.todos;
  return {
    doing: t ? t.doing.slice(0, 5) : [],
    next: t ? t.next.slice(0, 4) : [],
    docs: session && d && d.key === key ? d.list.slice(0, 4) : [],
    summary: session ? null : sessionSummary(mine, d, key),
    note: s?.view === "fallback" ? `No session activity yet: showing ${s.repo?.name ?? "personal"}` : null,
  };
}
