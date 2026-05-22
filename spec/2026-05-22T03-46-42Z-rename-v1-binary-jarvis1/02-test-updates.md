# 02 — Test updates and command-boundary verification

Update tests that assert on user-facing command strings so they match the renamed v1 binary, then verify the final boundary: `jarvis1` runs v1 and bare `jarvis` is no longer owned by v1.

## Decisions

- This subspec owns only tests and end-state verification. Runtime source changes belong to subspec 01.
- Update assertions that check command text shown to users. Do not rename internal test fixture strings, temp-dir prefixes, protocol markers, or `.jarvis` path construction.
- The final smoke checks here are the only place the spec requires direct verification that `bin/jarvis1` works and `bin/jarvis` is gone.

## Files in scope

1. `v1/test/cli.test.ts`
2. `v1/test/run.test.ts`
3. `v1/test/init.test.ts`
4. `v1/test/plan-command.test.ts`
5. `v1/test/plan-worktree.test.ts`
6. `v1/test/triage-command.test.ts`

## Required changes

**`v1/test/cli.test.ts`**

- Rename the integration describe block from `bin/jarvis` to `bin/jarvis1`
- Update the symlink test to create and invoke `jarvis1`
- Update usage assertions to expect `Usage: jarvis1 ...`

**`v1/test/run.test.ts`**

- Update assertions that mention `jarvis log-server` and `jarvis triage`

**`v1/test/init.test.ts`**

- Update the `jarvis config` suggestion assertion

**`v1/test/plan-command.test.ts`**

- Update assertions that mention `jarvis plan --resume`, `jarvis plan --resume-draft`, `jarvis run`, and `jarvis log-server`

**`v1/test/plan-worktree.test.ts`**

- Update the `jarvis cleanup` assertion

**`v1/test/triage-command.test.ts`**

- Update the `jarvis cleanup` assertion

## Do NOT change

- `mkdtempSync(join(tmpdir(), "jarvis-..."))` temp-dir prefixes
- `"jarvis-e2e"` branch names
- `"jarvis-test@example.com"` and `"jarvis-test"` git config values
- `<!-- jarvis:narrative:start -->`, `<!-- jarvis:narrative:end -->` markers
- `<!-- jarvis-codex-invocation: ... -->` markers
- `".jarvis-project-resolution-anchor.md"` internal filenames
- `join(... ".jarvis" ...)` config/data path construction

## Task checklist

- [ ] Update all six test files listed above to expect `jarvis1` in user-facing output
- [ ] Leave protected internal test strings untouched
- [ ] Run the full test suite after the assertion updates
- [ ] Run the final binary smoke checks after tests pass

## Acceptance criteria

- [ ] `bun test` passes
- [ ] The updated test files contain no remaining assertions that expect a user-facing `jarvis ...` command string
- [ ] Running `bin/jarvis1 help` succeeds
- [ ] Running `bin/jarvis1 plan --help` succeeds and its usage output names `jarvis1`
- [ ] `bin/jarvis` is absent, or invoking it fails because v1 no longer owns the bare `jarvis` command

## Documentation updates

No documentation changes in this subspec.
