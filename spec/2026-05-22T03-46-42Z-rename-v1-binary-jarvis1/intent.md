---
name: rename-v1-binary-jarvis1
---
Rename the v1 command from `jarvis` to `jarvis1`, and reserve the bare `jarvis` command for v2. After this intent lands, v1 continues to run exactly as today but is invoked as `jarvis1`; the name `jarvis` is unowned until v2 starts implementing behaviors against it. This is step 2 of the v2 rollout — see `v2-vision.md`. Depends on the v1/v2 repo split having landed first.

Goal: a user with both versions installed can type `jarvis1 plan ...` and get today's behavior, while `jarvis` is free for the v2 command to take over as it gets built. The rename is the deliberate user-facing moment where v1 stops owning the bare `jarvis` command name; everything else about v1 stays identical.

What needs to happen, at a high level:
- The v1 binary entry resolves as `jarvis1`, not `jarvis`. After the split, this means the relevant package `bin` entry maps `"jarvis1"` to the v1 shim, and the root/v1 shim path is named or linked so symlink-based installs can target it directly.
- Remove the old v1-owned `jarvis` binary entry. Do not leave a compatibility alias from `jarvis` to v1.
- Internal v1 code that refers to the command name by string updates to `jarvis1`: help text, error prefixes, actionable command suggestions, log-server startup text, generated next-step output, tests that assert command text, and install instructions.
- README and install docs document the rename and the rationale (coexistence with v2). Install is symlink-based on the two machines that run jarvis; no package-manager release work is involved.
- CI adjusts to the new binary name where needed.
- No behavior changes inside v1 beyond the name.

Audit findings and decisions:

- The package metadata currently bakes in the binary name through `package.json` (`bin: { "jarvis": "bin/jarvis" }`) and `bun.lock` mirrors the package name. This change must update package metadata and refresh the lockfile if Bun changes it.
- The repository contains many in-tree command references in README/docs/tests/source strings. Update user-facing command invocations from `jarvis ...` to `jarvis1 ...` for v1 behavior. Keep product/name references as "Jarvis" where they describe the project rather than the executable.
- The current CLI does not meaningfully introspect its executable name. `src/cli.ts` uses `process.argv.slice(2)` only; test fake binaries use `process.argv.slice(2)` to capture adapter argv. There is no known branch on `argv[0]` that changes behavior by invocation name. The implementation should still run a final `process.argv`, `argv[0]`, `argv0`, and `BASH_SOURCE` audit after the split because paths will have moved.
- Keep stable data namespaces unchanged unless a later v2 intent explicitly changes them. This rename should not move `~/.jarvis`, telemetry paths, session paths, PR narrative markers, git trailers, config keys, or internal protocol markers just because they include the word `jarvis`.
- Keep repository identity unchanged. Do not rename the git repo, GitHub slug, root project name in prose, or the product title as part of this intent.
- Generated examples and next-step output are in scope when they tell the user what command to run. For example, plan-mode handoff output should say `jarvis1 run ...` after this change.

Verification:

- Existing v1 gates still pass from the root workspace after the split: `bun run typecheck`, `bun test`, `bun run check`, and `bun run ready`.
- Manual smoke tests should prove the command boundary: `bin/jarvis1 help` works, `bin/jarvis1 plan --help`/equivalent usage output names `jarvis1`, and `bin/jarvis` is absent or fails because no v2 command exists yet.
- Include focused tests where practical for the renamed shim/package bin and for generated command suggestions that previously asserted `jarvis ...`.

## Refine turn 1

### Confirmed file-level scope

After reading the repo, here is the concrete audit of every file that needs a change and what the change is:

**Binary shim and package metadata:**
- `bin/jarvis` → `bin/jarvis1`. The shim is a bash script that resolves symlinks and dispatches to `v1/src/cli.ts`. Its content stays identical; only the filename changes. The old `bin/jarvis` is deleted (no compat alias).
- `package.json` `bin` field: `{ "jarvis": "bin/jarvis" }` → `{ "jarvis1": "bin/jarvis1" }`. The `name: "jarvis"` field stays (repo identity).
- `bun.lock`: re-run `bun install` after the package.json change; commit the lockfile only if Bun actually changes it (bin-only metadata changes may or may not touch the lockfile).

**v1 source user-facing strings (update to `jarvis1`):**
- `v1/src/cli.ts`: `USAGE` string (`"Usage: jarvis <command> [args]"`), all `"jarvis: ..."` error prefix strings.
- `v1/src/commands/plan.ts`: `PLAN_USAGE` string (`"Usage: jarvis plan ..."`), worktree triage suggestion (`` `jarvis triage plan-${planName}` ``), no-commit next-step message (`"jarvis run ..."`), plan-complete handoff messages (`"jarvis plan --resume"` and `"jarvis run spec/..."`).
- `v1/src/log-server-preflight.ts`: `"jarvis: log server unreachable..."` prefix and `` `jarvis log-server` `` suggestion.
- `v1/src/modes/patch/run.ts`: `` `jarvis run` `` plan-branch-exists warning.
- `v1/src/commands/triage.ts`: `"jarvis cleanup"` and `"jarvis run"` action suggestions in triage output.

**Do NOT change in source:**
- `namespace: "jarvis"` in `v1/src/commands/plan.ts` (line ~118) — this is a telemetry/session-storage key, not a user-facing command string.
- `~/.jarvis/` config and sessions path strings throughout — data namespace, unchanged.
- Git trailer values, PR narrative markers, internal protocol strings.

**Tests (update to `jarvis1`):**
- `v1/test/cli.test.ts`: `describe("bin/jarvis", ...)` → `describe("bin/jarvis1", ...)`. The symlink test creates `linkPath = join(binDir, "jarvis")` pointing to `resolve("bin/jarvis")` — both paths update to `jarvis1`. The `expect(result.stdout.toString()).toContain("Usage: jarvis")` assertion updates to `"Usage: jarvis1"`. The `expect(cap.err()).toContain("Usage: jarvis config")` assertion (line ~223) updates to `"Usage: jarvis1 config"`.

**Documentation (update invocations to `jarvis1`):**
- `README.md`: install symlink line (`ln -s ~/code/jarvis/bin/jarvis /usr/local/bin/jarvis` → `ln -s ~/code/jarvis/bin/jarvis1 /usr/local/bin/jarvis1`), all command-line examples (`jarvis help`, `jarvis init`, `jarvis plan`, `jarvis run`, `jarvis config`, `jarvis prices`, `jarvis log-server`, `jarvis cleanup`, `jarvis triage`, `jarvis review-feedback`). The README line "The root `bin/jarvis` shim dispatches to `v1/src/cli.ts`" also updates.
- `CLAUDE.md`: Invocation-as-command references update (`"run it through \`jarvis\`"` → `"run it through \`jarvis1\`"`, `` `jarvis config` ``, `` `jarvis run` ``, `` `jarvis plan` ``, `` `jarvis init` ``, `` `jarvis triage` ``, `` `jarvis cleanup` ``). Product-name prose ("Jarvis is a minimal coding-agent harness", "Name: `jarvis`") stays unchanged.
- `v1/docs/spec-guidance.md`: All `jarvis run`, `jarvis plan`, `jarvis init`, `jarvis config` invocation examples. (Path references to `~/.jarvis/` stay.)
- `v1/docs/run-loop.md`, `v1/docs/quota-signals.md`, `v1/docs/agents.md`, `v1/docs/plan-mode.md`, `v1/docs/workflows.md`: Command invocation examples. Product-name prose stays. `~/.jarvis/` paths stay.

**CI — no changes needed.** `.github/workflows/ci.yml` invokes only `bun run typecheck`, `bun run test`, `bun run check` (package-script aliases, not the binary name directly).

### Subspec structure (4 subspecs)

- **00 — Binary shim and package metadata**: Create `bin/jarvis1` (same content as current `bin/jarvis`), delete `bin/jarvis`, update `package.json` bin field, run `bun install` and commit lockfile if changed. Acceptance: `bin/jarvis1` exists and is executable, `bin/jarvis` does not exist, `package.json` has `"jarvis1"` bin entry.
- **01 — v1 source string updates**: Update user-facing command strings in `cli.ts`, `plan.ts`, `log-server-preflight.ts`, `modes/patch/run.ts`, `triage.ts`. Do not touch data-namespace strings. Acceptance: `bun run typecheck` passes; `bun test` passes.
- **02 — Test updates**: Update `cli.test.ts` symlink describe block, symlink path, and Usage string assertions. Acceptance: `bun test` passes including the bin/jarvis1 symlink integration test.
- **03 — Documentation updates**: Update README.md, CLAUDE.md, and all `v1/docs/*.md` files for command invocation examples. Acceptance: no `bin/jarvis` or `` `jarvis `` (command-invocation) references remain in docs/CLAUDE.md; `bun run check` passes.

### Key boundary decisions

- `namespace: "jarvis"` in plan.ts telemetry is NOT renamed. The intent explicitly protects data namespaces.
- `name: "jarvis"` in `package.json` is NOT renamed (repo identity).
- `~/.jarvis/` path strings are NOT renamed anywhere.
- Prose that says "Jarvis" (the product) is NOT renamed.
- No compatibility alias from `jarvis` → `jarvis1` is added anywhere.
- The spec and worktree naming conventions (`plan/<name>`, `.worktree/plan-<name>/`) use the harness's own internal slug generation and are unaffected.

## Refine turn 2

### Additional source files missing from subspec 01

The Refine turn 1 source-file list for subspec 01 is incomplete. A grep of the repo finds five more files that contain user-facing `jarvis` command strings (error prefixes, actionable suggestions, status output) and must be included in subspec 01:

1. **`v1/src/modes/shared-entry.ts`** — duplicate `"jarvis: log server unreachable..."` and `` `jarvis log-server` `` suggestion (lines 105, 169, 107, 171); also `` `jarvis init` `` suggestion in the no-registered-projects error (line 272). These mirror the strings in `log-server-preflight.ts` but live in a different code path.

2. **`v1/src/worktree.ts`** — `` `jarvis cleanup` `` in a thrown-error message (line 106). Line 192 is a JSDoc comment that mentions `jarvis triage`; code comments are not user-facing and do not need updating.

3. **`v1/src/commands/init.ts`** — `"jarvis: init must be run inside..."` error prefix (line 44); `` `jarvis config` `` action suggestion in the already-registered error (line 58); `"jarvis: ${err}"` error prefix (line 77).

4. **`v1/src/commands/review-feedback.ts`** — multiple `"jarvis review-feedback: ..."` error/status prefix strings (lines 53, 109, 133, 136, 215, 227, 233).

5. **`v1/src/logging.ts`** — `"jarvis: invalid logServerBind ..."` error (line 56); `"jarvis: log server failed: ..."` error (line 99); `"jarvis log-server listening on ..."` startup status (line 105). The `namespace: "jarvis"` on line 22 is a data-namespace key and is NOT renamed (same rule as plan.ts telemetry).

The subspec 01 file list and its acceptance criteria should enumerate these files alongside the five already listed, and the acceptance-criteria "no user-facing `jarvis ` strings remain" check should cover all ten files.

## Refine turn 3

### Additional source files missing from subspec 01 (second pass)

A second grep reveals five more source files with user-facing `jarvis` command strings that were missed by both Refine turns 1 and 2:

1. **`v1/src/commands/config.ts`** — `USAGE` string (`"Usage: jarvis config <subcommand> [args]"`, line 17), plus sixteen `"jarvis: ..."` error-prefix strings covering every config subcommand (lines 127, 139, 147, 159, 178, 184, 196, 201, 215, 221, 228, 236, 261, 267, 273). These are all user-facing errors and usage text; they must update to `jarvis1:`.

2. **`v1/src/commands/prices.ts`** — `USAGE` string (`"Usage: jarvis prices <subcommand> [args]"`, line 5); `"jarvis: unknown prices subcommand ..."` error (line 34).

3. **`v1/src/commands/prices-edit.ts`** — `"jarvis: ..."` error prefixes (lines 38, 62).

4. **`v1/src/commands/prices-show.ts`** — `"jarvis: failed to load prices: ..."` error (line 30).

5. **`v1/src/disambiguation-prompt.ts`** — `"jarvis: ..."` error prefixes for invalid-choice errors (lines 63, 73).

The full subspec 01 source file list is now fifteen files: the five from turn 1, the five from turn 2, and these five. The acceptance criteria should reflect this complete list.

### Additional test assertion updates for subspec 02

The subspec 02 scope as stated covers only `v1/test/cli.test.ts`. The grep shows several other test files contain `toContain("jarvis ...")` assertions that test user-facing command strings and must be updated:

- **`v1/test/run.test.ts`** — Line 403: `toContain("jarvis log-server")` → `"jarvis1 log-server"`. Lines 577 and 1157: `toContain("jarvis triage")` → `"jarvis1 triage"`.
- **`v1/test/init.test.ts`** — Line 200: `toContain("jarvis config")` → `"jarvis1 config"`.
- **`v1/test/plan-command.test.ts`** — Line 100: `toContain("jarvis plan --resume")` → `"jarvis1 plan --resume"`. Line 102: `toContain(\`jarvis run spec/...\`)` → `"jarvis1 run"`. Line 512: `toContain("jarvis log-server")` → `"jarvis1 log-server"`. Line 1189: `toContain("jarvis plan --resume-draft spec/")` → `"jarvis1 plan --resume-draft"`.
- **`v1/test/plan-worktree.test.ts`** — Line 90: `toContain("jarvis cleanup")` → `"jarvis1 cleanup"`.
- **`v1/test/triage-command.test.ts`** — Line 287: `toContain("jarvis cleanup")` → `"jarvis1 cleanup"`.

### Explicit do-not-change list for tests

Many test occurrences of `jarvis` must NOT be updated; they are not user-facing command strings:
- `mkdtempSync(join(tmpdir(), "jarvis-..."))` temp-dir name prefixes — internal test plumbing.
- `"jarvis-e2e"` git branch names used in `git init -b`.
- `"jarvis-test@example.com"` and `"jarvis-test"` git config values.
- `<!-- jarvis:narrative:start -->`, `<!-- jarvis:narrative:end -->` — narrative markers (protected data-namespace).
- `<!-- jarvis-codex-invocation: ... -->` — internal protocol markers (protected).
- `".jarvis-project-resolution-anchor.md"` — internal filename (protected).
- Any `join(... ".jarvis" ...)` path construction — config/data namespace (protected).

## Blocker

Review and approve `spec/2026-05-22T03-46-42Z-rename-v1-binary-jarvis1/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis plan --resume-draft spec/2026-05-22T03-46-42Z-rename-v1-binary-jarvis1/intent.md`
