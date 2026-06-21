# 05 - Refactor shared + v2 tests; verify suite

## Problem

The `shared/` and `v2/src/` tests match process/clock primitives. Apply the 00 triage to this
final cluster, then confirm the whole remediated suite is deterministic, green, and at/above
its prior coverage. This is the closer: the corpus-wide green check lands here.

Files: `shared/{git,preload,worktree-lock}.test.ts`,
`v2/src/{external-worktree,preload,write-loop,write}.test.ts`.

## Decisions

- Apply each file's 00 verdict as in 01; inject a fixed clock for `shared/worktree-lock.test.ts`'s `new Date(` and route spawn/`execFile` through injected seams. Rules out rewriting cleared files.
- Final coverage check is preservation, not increase, checked against the assertion-inventory baseline 00 captured in `findings.md`: every distinct behavior assertion in that baseline is still exercised somewhere (kept, moved, or merged). Rules out an unfalsifiable preservation claim and silently dropping coverage while merging redundant tests.
- Run the full corpus once serially in addition to `--parallel` to confirm no ordering/parallelism dependence survived across all five clusters. Rules out a parallel-only pass masking residual ordering coupling.

## Task checklist

- [ ] Apply 00 verdicts to each `shared/` and `v2/src/` file.
- [ ] Inject clocks/spawn seams; merge/drop redundant cases the triage flagged.
- [ ] Reconcile `findings.md`: every `refactor`/`marked-exception` file across 01–05 is resolved.
- [ ] Run `bun test --parallel` and `bun test` (serial) over the whole corpus.
- [ ] Record in `v2/docs/v1-behaviors.md` only a seam that alters an observable default; test-only optional params defaulting to the real impl need no entry.

## Acceptance criteria

- [ ] Every `refactor`-verdict file in `shared/` and `v2/src/` no longer spawns a real OS process or depends on live wall-clock time; `already-deterministic` files are unchanged; `marked-exception` files are renamed `*.sandbox-unrunnable.test.ts` with a justification comment.
- [ ] No primitive-matching file across the corpus retains an unresolved `refactor`/`marked-exception` verdict from `findings.md`.
- [ ] Each distinct behavior assertion in the `findings.md` baseline is still exercised (kept, moved, or merged) — no net coverage loss measured against that baseline.
- [ ] `bun run test` (parallel) passes, and a serial `bun test` over the full corpus also passes (no ordering/parallelism dependence). Marked-exception files are verified green sandbox-off, per the green basis recorded in `findings.md`.
- [ ] `bun run typecheck` passes; any seam that alters an observable default is recorded in `v2/docs/v1-behaviors.md` (test-only optional params defaulting to the real impl need no entry).

## Documentation updates

- `v2/docs/v1-behaviors.md`: record any DI seam that alters an observable default, or note none added (additive test-only params defaulting to the real impl are not recorded).
