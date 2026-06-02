---
name: split-test-commands-ready
---

# Split test commands and wire ready to the aggregate

Jarvis currently has one root `bun test` entrypoint, and `ready` relies on that
single generic suite. Separate this from coverage work: the ask here is command
shape and the ready gate.

## Desired outcome

The root `package.json` exposes clear test commands for `v1`, `v2`, and
`shared`, plus an aggregate command that runs the full suite. `bun run ready`
uses that aggregate path so the release gate reflects the repo's ownership
boundaries.

Each tsconfig project (`v1`, `v2`, `shared`) already owns its own test
directory (shared tests in `shared/`, v2 tests co-located in `v2/src`, v1 tests
in `v1/test`); the split is already clean, so there is nothing to relocate. The
work is to add per-slice scripts scoped by *exact* directory root and an
aggregate, and to guard the boundary so a shared-owned test can't later drift
into `v1/test/`. `scripts/` has no tests and `test:shared` is `shared/` only.

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

- Define explicit root scripts, each scoped to an **exact** directory root
  (e.g. `bun test ./v1/`, not `bun test v1` which substring-matches):
  - `test:v1` → `./v1/`
  - `test:v2` → `./v2/`
  - `test:shared` → `./shared/`
  - aggregate `test` → bare `bun test` (independent whole-repo discovery, which
    already runs all three slices). Timeout comes from `bunfig.toml`
    (`[test] timeout = 30000`), so every invocation inherits it — no
    `--timeout` flag needed.
- Add a guard test asserting the exact-scoped slices don't overlap (no test
  file resolves into two slices), keeping the already-clean split from drifting.
  No relocation: there is nothing mislocated today.
- Relocate the global test preload `v1/test/setup-fake-agents.ts` to a neutral
  root home (it is repo-wide agent-spawn safety infra, not v1-owned) and
  repoint `bunfig.toml`'s `preload`. It stays global on purpose — shared and v2
  tests can spawn agents too — so the only change is honest ownership of the
  file's location.
- Update `scripts/ready.ts` so `bun run ready` runs the aggregate `test`.
- Document the commands and the shared-test boundary.
- Add tests for command wiring and ready-gate behavior.

## Likely decision points

- Where the relocated preload lives (e.g. root `test/` or `scripts/`). Pick one
  neutral home and repoint `bunfig.toml`.
- Whether `ready` should call only the aggregate test command or each slice
  explicitly for clearer logs.

## Acceptance criteria

- Root `package.json` exposes separate runnable test commands `test:v1`,
  `test:v2`, `test:shared`, each scoped to its exact directory root, plus an
  aggregate `test`.
- Each slice command targets an exact root path (`./v1/`, `./v2/`, `./shared/`),
  not a substring filter; the aggregate `test` is bare `bun test`.
- A guard test asserts the exact-scoped slices don't overlap.
- The 30s test timeout is preserved via `bunfig.toml` across every command.
- The agent-spawn safety preload lives at a neutral root home and `bunfig.toml`
  points at it; no test slice depends on a file under another slice's tree.
- `bun run ready` runs the aggregate `test`.
- Docs explain the new commands and what the shared slice includes.
- Automated tests cover the command wiring and ready-gate behavior enough to
  catch regressions in script names or execution order.

## Out of scope

- Adding or enforcing coverage reporting.
- Relocating *tests* (none are mislocated); only the global preload file moves.
- Changing `jarvis1` runtime behavior.
- Large prompt/test architecture changes beyond what is needed to define the
  shared slice clearly.

## Notes for drafting

- Keep the operator contract simple: obvious command names beat clever test
  discovery.
- The test tree is already cleanly split by owner; do not invent a new source
  layout. Only the global preload file moves.

## Refinement

- Keep `test` as the aggregate operator entrypoint and add any `test:all` name only as a compatibility alias if wanted; making `test:all` the sole aggregate and changing `test` away from full-repo execution is the wrong alternative.
- Scope each slice command to an exact directory root (`bun test ./v1/`, `./v2/`, `./shared/`); a bare `bun test shared` is a substring path filter that cross-contaminates slices and is the wrong alternative.
- The test tree is already cleanly owner-split (shared in `shared/`, v2 in `v2/src`, v1 in `v1/test`), so there is nothing to relocate; add a guard test that the exact-scoped slices don't overlap instead. Asserting a `union(slices) == aggregate` invariant is unnecessary — the aggregate is independent whole-repo discovery and forthcoming coverage work catches any missed test.
- The 30s timeout is supplied by `bunfig.toml` (`[test] timeout = 30000`) and inherited by every `bun test` invocation including scoped slices; re-adding a per-script `--timeout` flag is redundant and the wrong alternative.
- The agent-spawn safety preload is repo-wide infra and must load for all slices; relocate it from `v1/test/` to a neutral root home and repoint `bunfig.toml` rather than leaving it under a single slice's tree or dropping it from non-v1 slices.
- Make `ready` invoke the aggregate test script once instead of spelling out per-slice test commands in `scripts/ready.ts`; duplicating the slice list inside `ready` is the wrong alternative because the release gate would drift from the operator entrypoint.
- Record the root test-command contract and the new ready gate test step in `v2/docs/v1-behaviors.md`, with any procedural wording in `v1/docs/worktrees-and-commits.md` kept aligned by cross-reference rather than treated as the sole durable home; documenting this only in legacy `v1/docs/` pages or only in the subspec is the wrong alternative.

