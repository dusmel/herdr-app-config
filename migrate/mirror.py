#!/usr/bin/env python3
"""Shows a herdr TUI pane's screen, redrawn every second.

Servers keep running in the TUI; this lets their logs show in herdr-app.
Usage: mirror.py <tui-pane-id>
"""
import subprocess
import sys
import time

pane = sys.argv[1]
sys.stdout.write("\x1b[?25l")
try:
    while True:
        r = subprocess.run(["herdr", "pane", "read", pane, "--source", "visible", "--format", "ansi"], capture_output=True, text=True)
        if r.returncode:
            print(f"\nTUI pane {pane} is gone: {r.stderr.strip()}")
            break
        # Overwrite in place instead of clearing, so the screen doesn't flicker.
        lines = r.stdout.rstrip("\n").split("\n")
        sys.stdout.write("\x1b[H" + "\x1b[K\n".join(lines) + "\x1b[K\x1b[J")
        sys.stdout.flush()
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    sys.stdout.write("\x1b[?25h")
