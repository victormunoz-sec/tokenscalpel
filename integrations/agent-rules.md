## TokenScalpel Token-Diet Workflow (Additive — Does Not Override User Rules)
- Before reading any file over 400 lines in full, run `node ./tokenscalpel/src/outline.mjs <file>` to inspect exact `[line, endLine]` bounds, then extract only what you need with `--slice <symbol|start:end>`, `--diff`, or `--refs <symbol> [dir]`.
- Wrap verbose test, lint, or build commands with `node ./tokenscalpel/src/shell-diet.mjs --dsl -- <command>` to cap long logs and show only normalized deltas on repeat runs.
- Respect the F-02 Secret-Leak Denylist: never pass `--allow-sensitive` to `outline.mjs` unless the user explicitly asks to inspect a sensitive file.
- Keep these instructions strictly additive alongside your existing git, coding-style, and architecture rules.
