# Check our herdr-app setup against an update

herdr-app was updated. Our setup changes some of its stock mods by copying them, and copies never get updates. Your job: bring each copy up to date with our changes kept, and tell the person what the update makes worth rethinking.

Work in `~/.config/herdr-app`. `tools/reclone` gathers facts and merges files; you decide. `custom/manifest.json` says why each copy and own mod exists. Read it first.

## Before the restart

Use this section alone when the task says an update is downloaded but not installed. The new stock files only exist after the restart, so nothing can be merged yet. The job is to tell the person what the restart will cost before they press it.

1. Read `custom/waiting-notes.json`: the installed version, the waiting one, and the release notes the app holds. If it has no notes for the waiting version, look in `update-notes-cache.md`, then say the notes weren't available.
2. Read `custom/manifest.json`. For each copy and own mod, say whether a note touches it: the stock mod it copies, the API it calls, or the key it binds.
3. Note anything that would make a copy or own mod unneeded (rule 4 below).
4. Tell the person in this tab, in a few lines: safe to restart or not, what will need redoing after it, and ideas to rethink. Write no doc for this step.
5. Run `tools/reclone prechecked VERSION` with the waiting version. It clears the pill. After the restart the full check below runs.

## 1. See what moved

- `tools/reclone status`: each copy, our changes, and whether its stock source changed.
- `tools/reclone api`: what changed in `AGENTS.md`, `herdr.d.ts` and `gpui-kit.d.ts`.
- What's new: `updates().notes` is in `update-notes-cache.md` and `update-notes.json`.

## 2. Redo each copy whose stock changed

For each one marked STOCK CHANGED:

1. Read `tools/reclone upstream NAME` (their change) and `tools/reclone diff NAME` (ours).
2. Run `tools/reclone merge NAME`. It writes our edits onto today's stock in `custom/merged/NAME`.
3. Resolve any conflict by intent: the manifest says what our change is for. Prefer their new code and re-express our change in it.
4. Copy the merged files over `mods/NAME` (or `layouts/mine.json`), run `herdr-app check mods/NAME`, and read `herdr-app status` for errors.
5. Look at it: `tools/live-shot FILE` and read the PNG. If live-shot refuses, the window is hidden; ask the person to bring it forward.
6. `tools/reclone record NAME` once it works.

Copies whose stock did not change need nothing.

## 3. Check our own mods and keys

- `herdr-app check mods/<name>` for every mod in the manifest's `own` list.
- From the API diff: anything our mods call that was renamed or removed.
- New commands or default keys in `AGENTS.md` that `keys.json` lacks. List them; don't bind them unasked.

## 4. Rethink

For each copy and own mod, ask whether the update now does it natively or offers a better way: a built-in zoom badge, pane history, a space indicator, a hook a copy could become instead of a copy. Don't change course on your own. Put each idea in the report with what it would remove.

## 5. Report and finish

- If anything changed or you have ideas, write `herdr-app/update-<version>.md` in `~/.config/herdr/atlas/` with the `html-docs` skill (then `technical-writing` and `unslop`), and publish it. Sections: what the update changed for us, what you redid, what you checked by eye, ideas to rethink.
- Run `tools/reclone done`. It clears the status-bar pill.
- Tell the person in this tab, in a few lines: what you redid, what needs their decision, and the doc link.
