#!/usr/bin/env python3
"""Moves herdr TUI spaces into herdr-app. Plan: ~/.config/herdr/atlas/herdr-app/migrate-sessions.html

  migrate.py --dry-run          write spaces/<label>.json for every TUI space, change nothing
  migrate.py --apply FILE...    rebuild those spaces in herdr-app

Edit a JSON before applying: "skip": true on a space or a pane leaves it behind.
Close a space's Claude agents in the TUI before applying it: two processes on
one session ID write to the same transcript.
"""
import argparse
import json
import pathlib
import re
import shlex
import subprocess
import sys
import time

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "spaces"
MIRROR = HERE / "mirror.py"
SHELL = "/bin/zsh"


def run(argv):
    r = subprocess.run(argv, capture_output=True, text=True)
    if r.returncode:
        sys.exit(f"{' '.join(argv[:4])} failed: {(r.stderr or r.stdout).strip()}")
    return json.loads(r.stdout)


def herdr(*args):
    return run(["herdr", *args])["result"]


def app(command, args):
    return run(["herdr-app", "do", command, json.dumps(args)])


# --- dry run -----------------------------------------------------------------

def tree(panes):
    """The TUI's split tree, rebuilt from pane rectangles: find a straight cut
    that separates the panes into two groups, then recurse."""
    if len(panes) == 1:
        return panes[0]["id"]
    for axis, size, direction in (("x", "width", "right"), ("y", "height", "down")):
        for cut in sorted({p["rect"][axis] for p in panes})[1:]:
            a = [p for p in panes if p["rect"][axis] + p["rect"][size] <= cut]
            b = [p for p in panes if p["rect"][axis] >= cut]
            if a and b and len(a) + len(b) == len(panes):
                return {"split": direction, "first": tree(a), "second": tree(b)}
    sys.exit(f"no straight cut through {[p['id'] for p in panes]}")


def pane_entry(p, agents):
    info = herdr("pane", "process-info", "--pane", p["pane_id"])["process_info"]
    procs = info["foreground_processes"]
    entry = {"tui_pane": p["pane_id"], "folder": p.get("foreground_cwd") or p["cwd"], "kind": "shell", "skip": False}
    session = (agents.get(p["pane_id"], {}).get("agent_session") or {}).get("value")
    if session:
        entry.update(kind="agent", session=session, title=p.get("terminal_title_stripped", ""))
    elif procs and info["foreground_process_group_id"] != info["shell_pid"]:
        # The group leader is the command that was typed; the rest are its children.
        leader = next((q for q in procs if q["pid"] == info["foreground_process_group_id"]), procs[0])
        entry.update(kind="server", command=leader["cmdline"])
        if (leader["cmdline"] or "").split(" ")[0] == "claude":
            # An agent with no session ID can't be resumed.
            entry.update(kind="agent", session=None, skip=True)
    return entry


def dry_run():
    OUT.mkdir(exist_ok=True)
    agents = {a["pane_id"]: a for a in herdr("agent", "list")["agents"]}
    for w in herdr("workspace", "list")["workspaces"]:
        panes = herdr("pane", "list", "--workspace", w["workspace_id"])["panes"]
        tabs = []
        for t in herdr("tab", "list", "--workspace", w["workspace_id"])["tabs"]:
            mine = [p for p in panes if p["tab_id"] == t["tab_id"]]
            layout = herdr("pane", "layout", "--pane", mine[0]["pane_id"])["layout"]
            rects = [{"id": q["pane_id"], "rect": q["rect"]} for q in layout["panes"]]
            tabs.append({
                "name": t["label"],
                "tree": tree(rects),
                "panes": {p["pane_id"]: pane_entry(p, agents) for p in mine},
            })
        wt = w.get("worktree") or {}
        folder = wt.get("checkout_path") or tabs[0]["panes"][next(iter(tabs[0]["panes"]))]["folder"]
        busy = any(e["kind"] != "shell" for t in tabs for e in t["panes"].values())
        space = {
            "name": w["label"],
            "folder": folder,
            # Worktree spaces that only hold shells stay behind; `git worktree` brings them back.
            "skip": bool(wt.get("is_linked_worktree")) and not busy,
            "tabs": tabs,
        }
        slug = re.sub(r"[^a-z0-9]+", "-", w["label"].lower()).strip("-") or w["workspace_id"]
        (OUT / f"{slug}.json").write_text(json.dumps(space, indent=2, ensure_ascii=False) + "\n")
        kinds = [e["kind"] for t in tabs for e in t["panes"].values()]
        print(f"{'skip ' if space['skip'] else '     '}{slug}.json  {len(tabs)} tabs, "
              f"{kinds.count('agent')} agents, {kinds.count('server')} servers, {kinds.count('shell')} shells")


# --- apply -------------------------------------------------------------------

def argv_of(e):
    """None means a plain shell. Programs run through a login shell, so PATH and
    nvm match a normal terminal, and a shell stays when they exit."""
    if e["kind"] == "agent":
        cmd = f"claude --resume {shlex.quote(e['session'])}"
    elif e["kind"] == "server":
        cmd = f"python3 {shlex.quote(str(MIRROR))} {shlex.quote(e['tui_pane'])}"
    else:
        return None
    return [SHELL, "-lic", f"{cmd}; exec {SHELL} -l"]


def spec(e, **extra):
    args = {"folder": e["folder"], **extra}
    if argv_of(e):
        args["argv"] = argv_of(e)
    return args


def pane_of(terminal):
    for s in run(["herdr-app", "ls"])["spaces"]:
        for t in s["tabs"]:
            for term in t["terminals"]:
                if term["terminal"] == terminal:
                    return term["pane"]
    sys.exit(f"no pane shows terminal {terminal}")


def first_leaf(node):
    return node if isinstance(node, str) else first_leaf(node["first"])


def prune(node, panes):
    """Drops skipped panes from the tree; their sibling takes the space."""
    if isinstance(node, str):
        return None if panes[node]["skip"] else node
    a, b = prune(node["first"], panes), prune(node["second"], panes)
    return {**node, "first": a, "second": b} if a and b else a or b


def build(node, pane, panes):
    """`pane` already shows first_leaf(node); open the rest of the node around it."""
    if isinstance(node, str):
        return
    e = panes[first_leaf(node["second"])]
    app("pane.focus", {"pane": pane})
    opened = app("terminal.open", spec(e, place=node["split"]))
    other = opened.get("pane") or pane_of(opened["terminal"])
    build(node["first"], pane, panes)
    build(node["second"], other, panes)


def reuse(space_id, tab_name, e):
    """Takes over the space's first tab when it holds only an untouched shell,
    the one herdr-app opens with every space. Returns its pane, or None."""
    s = next(s for s in run(["herdr-app", "ls"])["spaces"] if s["id"] == space_id)
    terms = s["tabs"][0]["terminals"] if s["tabs"] else []
    if len(s["tabs"]) != 1 or len(terms) != 1 or terms[0]["status"] or terms[0]["app"]:
        return None
    app("tab.rename", {"id": s["tabs"][0]["id"], "name": tab_name})
    # clear: the old shell's screen holds prompts redrawn at every past window size.
    cmd = f"cd -- {shlex.quote(e['folder'])} && clear"
    if e["kind"] == "agent":
        cmd += f" && claude --resume {shlex.quote(e['session'])}"
    elif e["kind"] == "server":
        cmd += f" && python3 {shlex.quote(str(MIRROR))} {shlex.quote(e['tui_pane'])}"
    run(["hc", "send", "--json", terms[0]["terminal"], cmd])
    return terms[0]["pane"]


def tui_busy(pane):
    """True while something other than the pane's shell is in the foreground."""
    info = herdr("pane", "process-info", "--pane", pane)["process_info"]
    # The group id goes missing for a moment while a program exits.
    return info.get("foreground_process_group_id") != info["shell_pid"]


def prompt_text(pane):
    """What is typed in a TUI Claude's input box, or None if no box is on screen.
    Dim text is Claude's suggested next prompt, not a draft, so it doesn't count."""
    screen = subprocess.run(["herdr", "pane", "read", pane, "--source", "visible", "--format", "ansi"], capture_output=True, text=True).stdout
    lines = [l for l in screen.splitlines() if "❯" in l]
    if not lines:
        return None
    line = re.sub(r"\x1b\[2m.*?\x1b\[0m", "", lines[-1].split("❯", 1)[1])
    return re.sub(r"\x1b\[[0-9;]*m", "", line).replace("\xa0", " ").strip()


def leave_tui(space):
    """Exits each agent in the TUI so herdr-app can resume its session. An agent
    that is busy or has text in its prompt stays in the TUI and is skipped here."""
    for t in space["tabs"]:
        for e in t["panes"].values():
            if e["kind"] != "agent" or e["skip"]:
                continue
            pane = e["tui_pane"]
            try:
                status = herdr("agent", "get", pane)["agent"]["agent_status"]
            except SystemExit:
                status = None  # no agent there any more: nothing to exit
            if status:
                typed = prompt_text(pane)
                if status not in ("idle", "done") or typed != "":
                    e["skip"] = True
                    print(f"  left {pane} in the TUI: {status}, prompt {typed!r}")
                    continue
                subprocess.run(["herdr", "pane", "run", pane, "/exit"], capture_output=True)
            for _ in range(40):
                if not tui_busy(pane):
                    break
                time.sleep(0.5)
            else:
                e["skip"] = True
                print(f"  left {pane} in the TUI: Claude did not exit")


def apply(path, exit_agents=False):
    space = json.loads(pathlib.Path(path).read_text())
    if space["skip"]:
        print(f"skipped {path}")
        return
    if exit_agents:
        leave_tui(space)
    # herdr-app may already show this space; filling it keeps its colour and alt-N slot.
    shown = run(["herdr-app", "ls"])["spaces"]
    space_id = next((s["id"] for s in shown if s["name"] == space["name"]), None) \
        or next((s["id"] for s in shown if s["folder"] == space["folder"]), None)
    for t in space["tabs"]:
        root = prune(t["tree"], t["panes"])
        if not root:
            continue
        e = t["panes"][first_leaf(root)]
        if space_id and t is space["tabs"][0] and (pane := reuse(space_id, t["name"], e)):
            build(root, pane, t["panes"])
            continue
        if space_id is None:
            made = app("space.new", spec(e, name=space["name"], tab=t["name"]))
            space_id = made["space"]
        else:
            made = app("tab.new", spec(e, space=space_id, name=t["name"]))
        build(root, pane_of(made["terminal"]), t["panes"])
    print(f"moved {space['name']}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--apply", nargs="+", metavar="FILE")
    p.add_argument("--exit-agents", action="store_true", help="exit each space's idle TUI agents before applying it")
    a = p.parse_args()
    if a.dry_run:
        dry_run()
    elif a.apply:
        for f in a.apply:
            apply(f, a.exit_agents)
    else:
        p.print_help()


if __name__ == "__main__":
    main()
