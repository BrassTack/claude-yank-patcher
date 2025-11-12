# Claude Yank Patcher

Fixes **[Readline Yank Functionality Broken in Claude CLI #2088](https://github.com/anthropics/claude-code/issues/2088)** - restores Emacs-style keybindings (`Ctrl+W/K/U/Y`, `Ctrl+T`) to Anthropic's closed-source CLI.

The official CLI cuts text but forgets it immediately, making `Ctrl+Y` (yank/paste) non-functional and causing data loss. This project injects a tiny helper that:
- Restores `Ctrl+Y` yank functionality with proper kill ring behavior
- Tracks killed text with consecutive kill appending
- Fixes word boundaries and transpose characters
- Maintains per-version patches for easy updates

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

## Features

- **Kill ring**: `^K`, `^U`, `^W`, `Meta+D` kill text, `^Y` yanks it back
- **Consecutive kill appending**: Repeated kills append (forward) or prepend (backward) to kill buffer
- **Transpose**: `^T` swaps characters (special end-of-line behavior)
- **Word boundaries**: `^W` uses whitespace boundaries, `Meta+D` preserves trailing space

## Testing checklist

Always test the following scenarios after applying a patch:

### Single-line operations
- `Ctrl+K` (kill to end of line) followed by `Ctrl+Y` (yank)
- `Ctrl+U` (kill to start of line) followed by `Ctrl+Y`
- `Ctrl+W` (kill word backwards) followed by `Ctrl+Y`
- `Meta+D` (kill word forwards) followed by `Ctrl+Y`
- `Ctrl+T` (transpose characters)

### **Multi-line operations (critical)**
- **Example test**: With text `1\n2\n3\n4`, move cursor to line 2 and press `Ctrl+K` to kill line 2, then `Ctrl+Y` to yank it back. Should get exactly `2` (not `3\n4`)
- **End-of-line test**: Cut from end-of-line and verify `Ctrl+Y` pastes the exact content that was cut, including newline handling
- Cut multiple consecutive lines and verify `Ctrl+Y` pastes them back in the correct order
- Test that multi-line kills properly populate the kill ring without corruption

### Consecutive operations
- Multiple `Ctrl+W` operations should accumulate in kill ring
- Multiple `Ctrl+K` operations should append (not replace) in kill ring

## Maintenance checklist

- Keep `patch-claude` and `apply_killring_patch.js` in sync with the latest prompt structure.
- Commit the generated `patches/<version>/` folder whenever a new release is verified.
- Use `./claude <version>` to sanity-check features before archiving the patch.
- **Always test multi-line cut/yank operations** - this is a common failure mode (see [GitHub issue #5](https://github.com/BrassTack/claude-yank-patcher/issues/5))
- Avoid committing the sandboxes themselves---`.gitignore` excludes them by default.

Questions, bugs, or a new CLI shape? Update the replacements, rerun the installer, and capture the new patch state so the next upgrade is painless.
