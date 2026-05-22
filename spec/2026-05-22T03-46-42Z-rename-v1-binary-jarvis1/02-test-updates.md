# 02 — Test updates

Update test files that assert on user-facing command strings to expect `jarvis1` instead of `jarvis`. The intent is to keep tests aligned with the renamed binary and source strings changed in subspec 01. Internal test plumbing (temp dir prefixes, git config values, branch names, narrative markers, protocol strings, data paths) is explicitly not renamed.

## Files in scope

- `v1/test/cli.test.ts`
- `v1/test/run.test.ts`
- `v1/test/init.test.ts`
- `v1/test/plan-command.test.ts`
- `v1/test/plan-worktree.test.ts`
- `v1/test/triage-command.test.ts`

## Changes per file

**`v1/test/cli.test.ts`**
- `describe("bin/jarvis", ...)` → `describe("bin/jarvis1", ...)`
- `linkPath = join(binDir, "jarvis")` → `join(binDir, "jarvis1")`
- `resolve("bin/jarvis")` symlink target → `resolve("bin/jarvis1")`
- `toContain("Usage: jarvis")` → `toContain("Usage: jarvis1")`
- `toContain("Usage: jarvis config")` (line ~223) → `toContain("Usage: jarvis1 config")`

**`v1/test/run.test.ts`**
- Line ~403: `toContain("jarvis log-server")` → `toContain("jarvis1 log-server")`
- Lines ~577, ~1157: `toContain("jarvis triage")` → `toContain("jarvis1 triage")`

**`v1/test/init.test.ts`**
- Line ~200: `toContain("jarvis config")` → `toContain("jarvis1 config")`

**`v1/test/plan-command.test.ts`**
- Line ~100: `toContain("jarvis plan --resume")` → `toContain("jarvis1 plan --resume")`
- Line ~102: `toContain(\`jarvis run spec/...\`)` or equivalent → `toContain("jarvis1 run")`
- Line ~512: `toContain("jarvis log-server")` → `toContain("jarvis1 log-server")`
- Line ~1189: `toContain("jarvis plan --resume-draft spec/")` → `toContain("jarvis1 plan --resume-draft")`

**`v1/test/plan-worktree.test.ts`**
- Line ~90: `toContain("jarvis cleanup")` → `toContain("jarvis1 cleanup")`

**`v1/test/triage-command.test.ts`**
- Line ~287: `toContain("jarvis cleanup")` → `toContain("jarvis1 cleanup")`

## Do NOT change

- `mkdtempSync(join(tmpdir(), "jarvis-..."))` temp-dir name prefixes
- `"jarvis-e2e"` git branch names
- `"jarvis-test@example.com"` and `"jarvis-test"` git config values
- `<!-- jarvis:narrative:start -->`, `<!-- jarvis:narrative:end -->` narrative markers
- `<!-- jarvis-codex-invocation: ... -->` protocol markers
- `".jarvis-project-resolution-anchor.md"` internal filenames
- `join(... ".jarvis" ...)` config/data path construction

## Task checklist

- [ ] Update `v1/test/cli.test.ts` (describe block, symlink paths, Usage assertions)
- [ ] Update `v1/test/run.test.ts` (log-server and triage assertions)
- [ ] Update `v1/test/init.test.ts` (config suggestion assertion)
- [ ] Update `v1/test/plan-command.test.ts` (plan resume, run, log-server assertions)
- [ ] Update `v1/test/plan-worktree.test.ts` (cleanup assertion)
- [ ] Update `v1/test/triage-command.test.ts` (cleanup assertion)

## Acceptance criteria

- [ ] `bun test` passes, including the `bin/jarvis1` symlink integration test in `cli.test.ts`
- [ ] No `toContain("jarvis ` or `toContain(\`jarvis ` assertion remains in the six test files for user-facing command strings (protected strings from the do-not-change list above are excluded)

## Documentation updates

No documentation changes in this subspec.
