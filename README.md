# Claude Yank Patcher

Fixes **[Readline Yank Functionality Broken in Claude CLI #2088](https://github.com/anthropics/claude-code/issues/2088)** - restores Emacs-style keybindings (`Ctrl+W/K/U/Y`, `Ctrl+T`) to Anthropic's closed-source CLI.

The official CLI cuts text but forgets it immediately, making `Ctrl+Y` (yank/paste) non-functional and causing data loss. This project injects a tiny helper that implements full readline/emacs kill ring behavior:

## Features

### 1. Consecutive Kill Appending
Repeated kill commands now properly append to the kill buffer instead of replacing it, matching standard readline/emacs behavior:

- **Consecutive kills append**: When you press `^W`, `^K`, `^U`, or `Meta+D` multiple times in a row without any intervening commands, the killed text is appended to the kill buffer instead of replacing it.
- **Backward kills prepend**: `^W`, `^U` prepend to kill buffer
- **Forward kills append**: `^K`, `Meta+D` append to kill buffer
- **Intervening commands break the sequence**: Any cursor movement, typing, or other command between kills starts a new kill buffer entry.

### 2. Transpose Characters (`^T`)
New `^T` binding swaps characters with proper readline semantics:

- **In middle of line**: Swaps the character before the cursor with the character at the cursor, then moves cursor forward one position.
- **At end of line**: Swaps the two characters before the cursor (special readline behavior), cursor stays at end.
- **At start or with < 2 characters**: Does nothing.

### 3. Word Boundary Fixes
Corrects word deletion behavior to match readline:

- **`^W` (backward-kill-word)**: Now uses whitespace boundaries (WORD), matching readline. Example: `can't` is treated as one word, not three tokens.
- **`Meta+D` (kill-word)**: Now stops at end of word without consuming trailing space. Example: with cursor at `hel|lo world`, deletes only `"lo"`, leaving the space.

## Implementation

Uses offset tracking to detect consecutive kills without requiring hooks into the event system:

- **`lastKillEndOffsetRef`**: Tracks the cursor position after the last kill
- **Before each kill**: `recordKill` checks if current offset matches the last kill end offset
- **If they match (consecutive kill)**:
  - If `newOffset < O.offset` (backward kill like `^W`, `^U`) → prepend to kill buffer
  - Otherwise (forward kill like `^K`, `Meta+D`) → append to kill buffer
- **If they differ** → replace kill buffer (new kill sequence started)

Works correctly for ~95% of real-world usage. Rare edge case: if you manually move cursor and return to exact same position, might incorrectly append (unlikely in practice).

### Updating to new releases

1. Ask Claude Code, Codex, or whichever assistant you use to
  ```
  run ./patch-claude latest and build an updated patch
  ```
  That single request installs the newest CLI, formats the bundle, and tries the nearest recorded replacement sets.  The LLM will see it fail, and then build an new patch.
2. If the patch lands, sanity-check the sandbox with `./claude <version>` **and test multi-line cut/yank operations** (see testing checklist below), then commit the new `patches/<version>/` artefacts so the release stays reproducible.



## Quick start

```bash
# Install and patch a specific CLI version
./patch-claude 2.0.26

# Launch the patched sandbox for testing
./claude 2.0.26

# Install whatever version npm reports as "latest"
./patch-claude
```

Each run creates `sandboxes/<version>/` with the vendor package plus:
- `cli.js.backup` --- original bundle (first run only)
- `cli.pretty.js` --- formatted source for inspection
- `cli.js` --- patched, kill-ring-aware bundle
- `killring_patch_state.json` --- replacements that succeeded

After a successful patch the script mirrors those replacements into `patches/<version>/`. Commit that folder so the version can be reproduced later.

## System-wide installation

Install a system-wide `claude` command that uses the patched CLI:

```bash
# Install the wrapper (replaces your system claude command)
./install-wrapper

# Pin to a specific version (useful for rollback)
./install-wrapper --version 2.0.24

# Reset to use latest version
./install-wrapper

# See all options
./install-wrapper --help
```

The wrapper automatically uses your latest installed sandbox, or you can pin it to a specific version for stability.

## When a patch fails

1. Reformat the CLI to see the new structure:
   ```bash
   npx uglify-js sandboxes/<version>/node_modules/@anthropic-ai/claude-code/cli.js -b -o sandboxes/<version>/cli.pretty.js
   ```
2. Open `cli.pretty.js`, locate the prompt helper (search for the control-key map), and update or add the replacement entries in `patches/<version>/replacements.json` (or the fallback templates under `patches/_templates/killring/`).
3. Rerun `./patch-claude --version <version>` until it reports `✅ Kill ring patch ready`.

## Repo layout

- `patch-claude` / `tools/patch-claude.js` -- installer + patch orchestrator
- `tools/apply_killring_patch.js` -- applies replacement sets and records metadata
- `patches/<version>/` -- checked-in replacements known to work for that release
- `patches/_templates/` -- defaults the helper falls back to when no exact match exists
- `claude` -- helper that launches a patched sandbox (`./claude 2.0.26`)
- `tools/analysis/` -- one-off scripts for diffing and spelunking the vendor bundle

## Testing Instructions

Test consecutive kill appending:
```
Type: a b c
Press ^W three times → kills "c", then "b ", then "a " (prepended each time)
Press ^Y → should paste "a b c" (correct order!)

Type: hello and press ^K twice → kills rest of line, then next line (appended)
Press ^Y → should paste both lines

Move cursor anywhere, then press ^W → should only kill one word (sequence broken)
```

Test transpose (`^T`):
```
Type: abcd → cursor at end
Press ^T → becomes "abdc" (swapped last two chars, cursor stays at end)
Press ^A to go to start, then ^F twice to position between 'a' and 'b'
Press ^T → becomes "badc" (swapped 'a' and 'b', cursor moves forward)

Type: x at start → "xbadc"
Press ^A, then ^T → nothing happens (at start of line)
```

Test word boundaries:
```
Type: can't → cursor at end
Press ^W → deletes entire "can't" (whitespace boundary)

Type: hello world → press ^A, then ^F 3 times (cursor at hel|lo world)
Press Meta+D → deletes "lo" only, result: hel world (space preserved)
```

Test basic kill ring (regression):
```
Type: hello world
Press ^W → kills "world"
Press ^Y → pastes "world"

Press ^K → kills rest of line
Press ^Y → pastes what ^K killed (not "world")
```

### Critical Multi-line Test
- With text `1\n2\n3\n4`, move cursor to line 2 and press `Ctrl+K` to kill line 2
- Press `Ctrl+Y` to yank it back - should get exactly `2` (not `3\n4`)
- Test end-of-line cuts and verify newline handling
- Cut multiple consecutive lines and verify `Ctrl+Y` pastes them back in correct order

### Sequence Breaking Test
- Multiple `Ctrl+W` operations should accumulate in kill ring
- Move cursor or type any character between kills → should break sequence and start fresh
- Multiple `Ctrl+K` operations should append (not replace) in kill ring when consecutive

## Maintenance checklist

- Keep `patch-claude` and `apply_killring_patch.js` in sync with the latest prompt structure.
- Commit the generated `patches/<version>/` folder whenever a new release is verified.
- Use `./claude <version>` to sanity-check features using the detailed test cases above before archiving the patch.
- **Always test multi-line cut/yank operations** - this is a common failure mode (see [GitHub issue #5](https://github.com/BrassTack/claude-yank-patcher/issues/5))
- Test both consecutive kill appending and sequence breaking behavior
- Avoid committing the sandboxes themselves---`.gitignore` excludes them by default.

## Edge Cases & Limitations

- **95% accuracy**: Works correctly for ~95% of real-world usage
- **Rare edge case**: If you manually move cursor and return to exact same position as previous kill, might incorrectly append (unlikely in practice)
- **Sequence detection**: Relies on cursor position tracking; any operation that moves cursor breaks the kill sequence

Questions, bugs, or a new CLI shape? Update the replacements, rerun the installer, and capture the new patch state so the next upgrade is painless.
