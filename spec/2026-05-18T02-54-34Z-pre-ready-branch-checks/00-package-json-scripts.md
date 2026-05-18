# 00 — Add Biome fix scripts and `ready` composite to package.json

## Problem

`.github/workflows/ci.yml` runs four steps after checkout/setup-bun:

1. `bun install --frozen-lockfile`
2. `bun run typecheck`
3. `bun run test`
4. `bun run check`

There is no local script that mirrors this exactly. The existing `test:full` chain (`format && check && format:check && lint && typecheck && test`) does not match CI order, redundantly invokes lint/format separately from `check` (which already covers lint + format + import sort), and mutates files via the write-mode `format` step — wrong shape for a pre-ready gate. There are also no Biome fix-mode scripts available for developers to apply suggested rewrites before re-running checks.

## Decisions (locked)

- The composite script is named `ready`. `test:full` is **deleted outright**, not aliased — turn 2 confirmed no external callers (`package.json` line 17 is the only reference repo-wide).
- `ready` includes `bun install --frozen-lockfile` as the first step so a fresh worktree is one command away from a CI-equivalent run. This directly addresses the worktree pain point in the intent.
- `ready` invokes only the four CI steps in CI order. It does **not** invoke `lint` or `format:check` separately — `biome check` already covers lint + format + import sort.
- Add the five new Biome scripts verbatim from the intent: `check:fix`, `check:fix:unsafe`, `format:unsafe`, `lint:fix`, `lint:fix:unsafe`. Preserve the existing naming asymmetry (`format` is write, `format:check` is read-only; `check` and `lint` are read-only and their new `:fix` variants are the writers) — do not rename existing scripts. Do **not** add a `format:fix` script: `format` already writes, so `format:fix` would be a confusing alias and the intent does not list it.
- `:unsafe` variants are developer convenience for inspected fixups only. They are not part of the `ready` script and not part of CI.

## Tasks

- [ ] Add to `package.json` scripts, exactly as listed in the intent:
  - `"check:fix": "bun node_modules/@biomejs/biome/bin/biome check --write ."`
  - `"check:fix:unsafe": "bun node_modules/@biomejs/biome/bin/biome check --write --unsafe ."`
  - `"format:unsafe": "bun node_modules/@biomejs/biome/bin/biome format --write --unsafe ."`
  - `"lint:fix": "bun node_modules/@biomejs/biome/bin/biome lint --write ."`
  - `"lint:fix:unsafe": "bun node_modules/@biomejs/biome/bin/biome lint --write --unsafe ."`
- [ ] Add `"ready": "bun install --frozen-lockfile && bun run typecheck && bun run test && bun run check"`.
- [ ] Remove the existing `test:full` entry.

## Acceptance criteria

- [ ] `package.json` contains the five new Biome scripts with the exact command strings above.
- [ ] `package.json` contains a `ready` script with value `bun install --frozen-lockfile && bun run typecheck && bun run test && bun run check`.
- [ ] `package.json` no longer contains a `test:full` script.
- [ ] Existing scripts (`check`, `format`, `format:check`, `lint`, `typecheck`, `test`, `install-opencode-permissions`, `start`) are unchanged.
- [ ] `bun run ready` invokes the four steps in CI order (install → typecheck → test → check) and short-circuits on the first failure via `&&` chaining. On a branch whose CI is green at HEAD, the local run completes end-to-end. Failures attributable to the branch's own code (not the script wiring) are out of scope for this subspec.
- [ ] A repo-wide search for `test:full` returns no remaining references in tracked files.

## Out of scope

- Changing `.github/workflows/ci.yml`.
- Adding pre-commit or pre-push git hooks.
- Wiring `bun run ready` into any agent loop, skill, or automation.
- Optimizing worktree install latency (symlinks, shared caches, etc.).
