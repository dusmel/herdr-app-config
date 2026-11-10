#!/usr/bin/env python3
"""Moves one TUI agent whose prompt holds an unsent draft into herdr-app,
keeping the draft: it is deleted in the TUI and typed back, unsent, after
`claude --resume`.

  carry.py SPACE.json TUI_PANE HERDR_PANE   resume to the right of HERDR_PANE
"""
import json
import subprocess
import sys
import time

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))
import migrate as m


draft = m.prompt_text


def typed(terminal):
    screen = subprocess.run(["hc", "read", "--lines", "0", terminal], capture_output=True, text=True).stdout
    return [l for l in screen.splitlines() if "❯" in l][-1].split("❯", 1)[1].replace("\xa0", " ").strip()


def main():
    path, tui, beside = sys.argv[1:4]
    space = json.load(open(path))
    e = next(p for t in space["tabs"] for p in t["panes"].values() if p["tui_pane"] == tui)
    text = draft(tui)
    print(f"draft: {text!r}")
    if text:
        subprocess.run(["herdr", "agent", "send-keys", tui, *["backspace"] * len(text)], capture_output=True, check=True)
    # The screen takes a moment to show the Backspaces.
    for _ in range(15):
        if not draft(tui):
            break
        time.sleep(0.2)
    else:
        sys.exit("the draft did not clear; nothing moved")
    m.leave_tui({"tabs": [{"panes": {tui: e}}]})
    if e["skip"]:
        sys.exit(f"{tui} did not exit; it stays in the TUI")
    m.app("pane.focus", {"pane": beside})
    terminal = m.app("terminal.open", m.spec(e, place="right"))["terminal"]
    subprocess.run(["hc", "wait", terminal, "--timeout", "60"], capture_output=True)
    if text:
        subprocess.run(["hc", "keys", terminal, *["space" if c == " " else c for c in text]], capture_output=True, check=True)
    got = typed(terminal)
    print(f"{terminal} input box: {got!r}", "(matches)" if got == text else "(DIFFERS)")


if __name__ == "__main__":
    main()
