---
name: split-test-commands-ready
---

# Split test commands and wire ready to the aggregate

Jarvis currently has one root `bun test` entrypoint, and `ready` relies on that
single generic suite. Separate this from coverage work: the ask here is command
shape and the ready gate.

## Desired outcome

The root `package.json` exposes clear test commands for `v1`, `v2`, and
shared/root-owned tests, plus an aggregate command that runs the full required
set. `bun run ready` uses that aggregate path so the release gate reflects the
repo's ownership boundaries.

Each tsconfig project (`v1`, `v2`, `shared`) owns its own test directory.
Tests currently misplaced — root/shared-owned tests living under `v1/test/` —
are relocated to their owner, so each `test:*` command is a simple directory
rule rather than an ownership-aware filter over a shared folder.

## Why this matters

- v1 is the shipping implementation, v2 is the next implementation, and shared
  code sits at the repo root. Operators need to run only the slice they are
  touching.
- A single catch-all test command gets less useful as v2 grows with co-located
  tests.
- `ready` should encode the actual repo contract rather than relying on a
  historical shortcut.
- Coverage policy can evolve separately once the command boundaries are stable.

## Scope

- Define explicit root scripts for:
  - `test:v1`
  - `test:v2`
  - `test:shared`
  - an aggregate path such as `test` or `test:all`
- Preserve or intentionally replace the existing `bun test` behavior.
- Decide what counts as shared/root-owned tests, then **relocate** those
  currently under `v1/test/` into their owning tree so each command routes by
  directory, not by an ownership filter.
- Update `scripts/ready.ts` so `bun run ready` runs the aggregate required test
  set.
- Document the commands and the shared-test boundary.
- Add tests for command wiring and ready-gate behavior.

## Likely decision points

- Whether `test` remains the aggregate command or becomes a compatibility alias
  to a new `test:all`.
- Whether `test:v1` is exactly today's suite minus v2/shared files, or whether
  any legacy tests stay temporarily in the aggregate until they can be sorted.
- What belongs in the shared slice today. Likely candidates are repo-root
  scripts, prompt-related tests that exercise top-level prompt artifacts, and
  any source moved out of `v1/` and `v2/`.
- Whether `ready` should call only the aggregate test command or each slice
  explicitly for clearer logs.

## Acceptance criteria

- Root `package.json` exposes separate runnable test commands for `v1`, `v2`,
  and shared/root-owned tests.
- No root/shared-owned tests remain under `v1/test/`; each tsconfig project owns
  its own test directory and its `test:*` command resolves by directory.
- A top-level aggregate command runs all required test slices.
- `bun run ready` runs the full required test set across `v1`, `v2`, and shared
  slices.
- Docs explain the new commands and what the shared slice includes.
- Automated tests cover the command wiring and ready-gate behavior enough to
  catch regressions in script names or execution order.

## Out of scope

- Adding or enforcing coverage reporting.
- Moving *correctly-owned* tests around for cosmetics. (Relocating the
  mis-owned tests out of `v1/test/` to their owner is in scope, above.)
- Changing `jarvis1` runtime behavior.
- Large prompt/test architecture changes beyond what is needed to define the
  shared slice clearly.

## Notes for drafting

- Keep the operator contract simple: obvious command names beat clever test
  discovery.
- Relocating the mis-owned tests to their owner is expected; beyond that, do not
  invent a new source layout just for the command split.

## Refinement

- Keep `test` as the aggregate operator entrypoint and add any `test:all` name only as a compatibility alias if wanted; making `test:all` the sole aggregate and changing `test` away from full-repo execution is the wrong alternative.
- Tests live with the code they cover: relocate the root/shared-owned tests currently under `v1/test/` into their owning tree so each tsconfig project (`v1`/`v2`/`shared`) owns its test directory and its `test:*` command is a simple directory rule. Leaving them misplaced and routing around them with ownership-aware globs is the wrong alternative — it bakes the misplacement in.
- Make `ready` invoke the aggregate test script once instead of spelling out per-slice test commands in `scripts/ready.ts`; duplicating the slice list inside `ready` is the wrong alternative because the release gate would drift from the operator entrypoint.
- Record the root test-command contract and the new ready gate test step in `v2/docs/v1-behaviors.md`, with any procedural wording in `v1/docs/worktrees-and-commits.md` kept aligned by cross-reference rather than treated as the sole durable home; documenting this only in legacy `v1/docs/` pages or only in the subspec is the wrong alternative.

## Blocker

Review and approve `v2/spec/2026-06-01T16-20-22Z-split-test-commands-ready/intent.md` before drafting subspecs.

Optional feedback:
- Add missing constraints, assumptions, and risks directly in `intent.md`.
- If scope is unclear, append focused questions to this blocker section.

Resume drafting once approved:
`jarvis1 plan --resume-draft v2/spec/2026-06-01T16-20-22Z-split-test-commands-ready/intent.md`
