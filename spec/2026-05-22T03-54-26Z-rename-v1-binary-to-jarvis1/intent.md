---
name: rename-v1-binary-to-jarvis1
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

Concrete audit of the current repo state (post v1/v2 split), confirming scope and adding precision where the intent is vague.

**Binary and package metadata (small, precise)**

- `bin/jarvis` (bash shim) → rename to `bin/jarvis1`. The shim body itself has no hard-coded name; only the file path changes.
- `package.json` `bin` field: `{ "jarvis": "bin/jarvis" }` → `{ "jarvis1": "bin/jarvis1" }`. The `package.json` `"name"` field (`"jarvis"`) is the npm package name, not the CLI command name — leave it unchanged per the repo-identity preservation rule.
- `bun.lock` mirrors the `bin` field entries; re-run `bun install` after the `package.json` edit and commit the lockfile diff if Bun modifies it.

**Source string changes — user-facing command invocations to update**

Files in `v1/src/` with user-visible `jarvis ...` command strings (119 occurrences across 27 files total, but most are comments or product-name prose; the user-facing ones are):

- `v1/src/cli.ts`: `USAGE` constant (`Usage: jarvis <command>`) and every error prefix (`"jarvis: ..."`, `"jarvis cleanup: ..."`, `"jarvis triage: ..."`, `"jarvis review-feedback: ..."`).
- `v1/src/commands/plan.ts`: `PLAN_USAGE` (`Usage: jarvis plan ...`) and the post-completion handoff strings that tell the user to run `jarvis run ...` or `jarvis plan --resume ...` (lines ~2234, ~2268, ~2271).
- `v1/src/commands/config.ts`: `USAGE` (`Usage: jarvis config ...`).
- `v1/src/modes/shared-entry.ts`: actionable log-server suggestions (`jarvis log-server`, `jarvis init`).
- `v1/src/log-server-preflight.ts`: startup message mentioning `jarvis log-server`.
- `v1/src/logging.ts`: log-server listening message (`jarvis log-server listening on ...`).
- `v1/src/commands/init.ts`: error mentioning `jarvis config`.
- `v1/src/modes/patch/run.ts`: triage suggestions (`jarvis triage ...`, `jarvis run ...`).
- `v1/src/commands/triage.ts`: suggested next-move strings (`jarvis cleanup`, `jarvis run`).
- `v1/src/commands/review-feedback.ts`: all `"jarvis review-feedback: ..."` error/info prefixes.
- `v1/src/worktree.ts`: triage suggestion (`jarvis cleanup`).

**Source strings to leave unchanged**

- `v1/src/logging.ts` line ~22: `namespace: "jarvis"` — internal log channel identifier, not user-facing.
- `v1/src/commands/plan.ts` line ~118: `namespace: "jarvis"` — same.
- All comment-only occurrences (JSDoc, inline notes) — not user-visible.
- Product-name prose ("Jarvis", "jarvis run" appearing inside JSDoc as a description of a concept rather than an invocation hint) — use judgment: if a reader would type the string, update it; if it names the product or documents the concept, leave it.

**Test changes**

- `v1/test/cli.test.ts` `describe("bin/jarvis")` block: update the symlink target and link name to `bin/jarvis1`, and update the `"Usage: jarvis"` assertion to `"Usage: jarvis1"`.
- Any other tests that assert specific `"jarvis ..."` substrings in usage/error output will need the same treatment — search `v1/test/` for `"jarvis "` (with a space) to catch them.

**Docs and README**

- `README.md`: ~40 command invocations (`jarvis run`, `jarvis plan`, `jarvis init`, etc.) — all user-facing command strings should become `jarvis1 ...`. Product-name instances ("Jarvis" capitalised, or descriptions like "the jarvis harness") stay.
- `v1/docs/`: 225 occurrences across 10 files. Same rule: command strings → `jarvis1`, product/concept prose → unchanged.
- `CLAUDE.md`: contains one user-facing command reference on line 21 (`jarvis config`, `jarvis init`, `jarvis run <spec>`) — update those to `jarvis1`.

**CI**

`.github/workflows/ci.yml` does not reference the `jarvis` binary name directly — it only runs `bun run typecheck`, `bun run test`, and `bun run check`. No CI changes needed.

**Subspec decomposition hint**

This work naturally splits into two atomic subspecs:
1. Binary, package metadata, and source/test string updates (mechanical rename in TypeScript source and tests).
2. README, docs, and CLAUDE.md prose updates (documentation pass).

Both can be implemented and verified independently. The first subspec is the gate: `bun run typecheck` and `bun test` must pass after it. The second subspec needs no compilation gate but should be reviewed for completeness against the file list above.

## Refine turn 2

Corrections and precise enumeration based on direct repo audit.

**Count corrections**

- README: 32 user-facing command invocations (not ~40). Verify with `grep -n "jarvis run\|jarvis plan\|jarvis init\|jarvis log-server\|jarvis cleanup\|jarvis triage\|jarvis config\|bin/jarvis" README.md`.
- `v1/docs/`: 135 occurrences (not 225). The 10-file list is correct.

**Missing source-file entries from Refine turn 1**

These were omitted from the v1/src user-facing list but found via audit:

- `v1/src/commands/plan.ts` line ~394: `jarvis triage plan-${planName}` in the plan-worktree-dirty error message — update.
- `v1/src/commands/plan.ts` line ~620: `jarvis init` in the no-registered-project error message — update.
- `v1/src/log-server-preflight.ts` line ~35: `jarvis log-server` in the preflight error (this was listed in Refine turn 1 but the file was also identified separately in shared-entry.ts; both need updating).

**Precise test file enumeration (replaces "search v1/test/ for 'jarvis '")**

All occurrences found by `grep -rn '"jarvis ' v1/test/ --include="*.ts"` (excluding fixture data files):

- `v1/test/cli.test.ts:223` — `expect(cap.err()).toContain("Usage: jarvis config")` → `"Usage: jarvis1 config"`
- `v1/test/cli.test.ts:332-345` — `describe("bin/jarvis")` block: symlink target `resolve("bin/jarvis")` → `resolve("bin/jarvis1")`; `linkPath` name `"jarvis"` → `"jarvis1"`; `"Usage: jarvis"` assertion → `"Usage: jarvis1"`.
- `v1/test/init.test.ts:200` — `expect(cap.err()).toContain("jarvis config")` → `"jarvis1 config"`
- `v1/test/run.test.ts:403` — `expect(cap.err()).toContain("jarvis log-server")` → `"jarvis1 log-server"`
- `v1/test/run.test.ts:577` — `expect(cap.err()).toContain("jarvis triage")` → `"jarvis1 triage"`
- `v1/test/run.test.ts:1157` — `expect(cap.err()).toContain("jarvis triage")` → `"jarvis1 triage"`
- `v1/test/triage-command.test.ts:287` — `expect(lines[0]).toContain("jarvis cleanup")` → `"jarvis1 cleanup"`
- `v1/test/plan-worktree.test.ts:90` — `expect(message).toContain("jarvis cleanup")` → `"jarvis1 cleanup"`
- `v1/test/plan-command.test.ts:100` — `expect(text).toContain("jarvis plan --resume")` → `"jarvis1 plan --resume"`
- `v1/test/plan-command.test.ts:512` — `expect(cap.err()).toContain("jarvis log-server")` → `"jarvis1 log-server"`
- `v1/test/plan-command.test.ts:1189` — `expect(out).toContain("jarvis plan --resume-draft spec/")` → `"jarvis1 plan --resume-draft spec/"`
- `v1/test/modes/plan/prompts.test.ts:189` — string contains `"'jarvis cleanup'"` inside a plan spec description used as test fixture content. This is a command a user would type, embedded in spec prose — update `jarvis cleanup` → `jarvis1 cleanup` here too.

**Subspec 1 scope is complete as stated.** All above test and source files fall in subspec 1 (binary, metadata, source/test strings). Subspec 2 (README, v1/docs, CLAUDE.md) is unchanged from Refine turn 1.

## Refine skip

Repo audit confirms Refine turn 2 is accurate and complete. Verified: `bin/jarvis` exists and is the only shim, `package.json` has `"bin": { "jarvis": "bin/jarvis" }`, all 10 test-file assertions match the enumerated line numbers, README has 32 command invocations, and `v1/docs/` has ~126 command occurrences (slight count difference from the stated 135 due to grep-pattern variation — does not affect scope). CLAUDE.md command references are on lines 21 and 66; line 21 contains user-invocable `jarvis config`, `jarvis init`, `jarvis run <spec>` and should be updated; line 66 is product-description prose ("jarvis writes onto every commit") and should be left unchanged. No additional refinement needed; intent is ready for drafting.

## Blocker

Review and approve `spec/2026-05-22T03-54-26Z-rename-v1-binary-to-jarvis1/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis plan --resume-draft spec/2026-05-22T03-54-26Z-rename-v1-binary-to-jarvis1/intent.md`
