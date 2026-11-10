@AGENTS.md

# Our customizations

herdr-app rewrites `AGENTS.md` on every start, so our rules live here.

## Before you change how herdr-app looks or behaves

1. Read `custom/manifest.json`. It says what we already changed and why.
2. Pick the lightest way that works, in this order:
   - A setting in `settings.json` or a binding in `keys.json`.
   - An own mod (`mods/<name>/` with no `cloned_from`), placed as a layout block or opened from a key.
   - A copy of a stock mod. Only when the change must live inside that mod. Copies never get updates.
3. To copy a stock mod, run `herdr-app do mod.clone`, then `tools/reclone init`, then add a line to `custom/manifest.json` saying why.
4. Never call `mod.clone` for a scratch copy. It can add the new mod to the shown layout as a block. For a throwaway copy, copy the files.
5. Add every own mod to the manifest's `own` list too.

## Check the change

- `herdr-app check mods/<name>`, then `herdr-app status` for `.errors`.
- Look at it with `tools/live-shot FILE` and read the PNG. A bare `herdr-app shot` is stale when the window is hidden.
- Don't toggle layout blocks the person uses (the sidebar, the panel) to test. If you must, put them back.

## Updates

`custom/CHECK.md` is the update playbook. The status-bar pill starts it before a restart (from release notes) and after one (merges the copies).
