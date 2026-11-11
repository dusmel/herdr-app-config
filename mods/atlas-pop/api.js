// Source: mods/atlas-chip/api.js. Mods cannot import across folders, so atlas-pop and atlas-panel hold copies; edit the source, then copy it.
// The Atlas server and repo lookup, shared by atlas-chip, atlas-pop and atlas-panel.
// The token comes from the atlas CLI's own config and stays in memory.
import * as fs from "fs/promises";
import { home, readTextFile, exec } from "herdr";

export const ATLAS = () => `${home()}/MEGA/Documents/atlas`;

let conf = null;
async function config() {
  if (conf) return conf;
  const text = await readTextFile(`${home()}/.config/atlas/config.json`).catch(() => null);
  try { conf = JSON.parse(text ?? ""); } catch { conf = null; }
  return conf;
}

async function call(path, init = {}) {
  const c = await config();
  if (!c?.url || !c?.token) throw new Error("atlas config missing");
  const r = await fetch(`${c.url}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${c.token}`, "x-atlas-author": "me", "x-atlas-device": c.device ?? "herdr-app", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`atlas ${r.status}`);
  return r.json();
}

export const listTodos = (repo, status) => call(`/api/todos?status=${status}${repo ? `&repo=${encodeURIComponent(repo)}` : ""}`);
export const updateTodo = (id, body) => call(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const moveTodo = (id, body) => call(`/api/todos/${id}/move`, { method: "POST", body: JSON.stringify(body) });
export const PERSONAL = { id: "_personal", name: "personal" };
export const repoRef = (repo) => (repo?.id ? { id: repo.id, name: repo.name } : repo?.name ?? PERSONAL);
export const addTodo = (body) => call(`/api/todos`, { method: "POST", body: JSON.stringify(body) });

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
  return { start: best.startedAt, cwd: best.cwd, transcript: (await fs.exists(transcript).catch(() => false)) ? transcript : null };
}

// docs.sh output ("mtime<TAB>path" lines) as rows: x.md and x.html share one row
// that opens the html; plans and designs first, then newest. At most 50.
export function docList(stdout, repo) {
  const rows = new Map();
  for (const line of stdout.split("\n")) {
    const [m, path] = line.split("\t");
    if (!path) continue;
    const stem = path.replace(/\.(md|html)$/, "");
    const row = rows.get(stem) ?? { stem, mtime: 0, open: path };
    row.mtime = Math.max(row.mtime, Number(m) * 1000);
    if (path.endsWith(".html")) row.open = path;
    rows.set(stem, row);
  }
  return [...rows.values()]
    .map((r) => {
      // "atlas-mod/plan", tagged with its repo when that isn't the focused one.
      const rel = r.stem.slice(ATLAS().length + 1);
      const m = rel.match(/^repos\/([^/]+)\/(.*)$/);
      const where = m ? m[1] : "atlas";
      return { ...r, name: (m ? m[2] : rel).split("/").slice(-2).join("/"), where: where === repo?.name ? null : where, effort: /\/(plan|design)$/.test(r.stem) };
    })
    .sort((a, b) => (b.effort - a.effort) || (b.mtime - a.mtime))
    .slice(0, 50);
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
