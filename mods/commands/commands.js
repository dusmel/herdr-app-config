// The palette's commands, in the order shown. `action` is anything keys.json
// accepts: "command" or "command:value", or { command, args }.
export default [
  { title: "Toggle tab bar", action: "layout.toggle:tabs" },
  { title: "Toggle sidebar", action: "layout.toggle:sidebar" },
  { title: "Toggle right panel", action: "layout.toggle:panel", words: "files changes" },
  { title: "Zen", action: "mod.open:zen", words: "focus distraction" },
  { title: "Go to a space", action: "mod.open:space-jump", words: "switch jump" },
  { title: "lazygit", action: "mod.open:lazygit", words: "git" },
  { title: "Dim space avatars", action: "mod.open:dim-avatars", words: "colors" },
  { title: "Herdr command palette", action: "app.palette", words: "all" },
];
