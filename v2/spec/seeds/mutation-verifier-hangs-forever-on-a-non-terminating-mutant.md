---
name: mutation-verifier-hangs-forever-on-a-non-terminating-mutant
---

# A guard-flip inside `while (true)` produces a non-terminating mutant, and the verifier waits for it forever

## Problem

The diff-derived mutation verifier applies a mutant, runs the resolved killing tests, and restores the file. Nothing bounds the killing-test subprocess on this path, and nothing bounds the mutant itself. When the mutated guard is the **exit condition of a `while (true)` loop**, the mutant does not terminate — so the verifier waits forever.

Every consequence follows from that single hang:

- The killing-test child pegs a core indefinitely and grows an unbounded array.
- The owning run stays `in-progress` / `live` with **no agent process**, past every watchdog — the iteration ceiling never fires, because the write step already finished and this is a daemon-spawned verifier child.
- `jarvis run kill` and `jarvis run kill --force` both report `killed` and change nothing: settlement waits on quiescence, quiescence waits on this child. See [[run-kill-reports-success-without-killing]].
- The worktree is left **poisoned with an inverted production guard**, because restore only happens after the test returns.

The last point is the dangerous one. An operator inspecting that worktree finds a corrupted source file that looks like agent work, with no marker saying a verifier put it there.

## Evidence (2026-09-06, exact)

Lane `20260906T034511Z-daemon-structural-invariant-test-anchors`, run `04fba343`. `iteration_started` at 16:25:48 was still the last log event 90 minutes later. No agent process for the worktree. One child: `bun test v2/src/daemon/daemon-run-control-handler-guard.test.ts`, parented to the **daemon**, at 100% CPU (peaking 181%) for over 2.5 hours.

The worktree's only uncommitted source change was the mutant itself, in `v2/src/daemon/daemon-run-control-handler-guard.ts`:

```diff
       let from = 0;
       while (true) {
         const index = source.indexOf(symbol, from);
-        if (index === -1) break;
+        if (index !== -1) break;
         violations.push({ file, symbol, line: source.slice(0, index).split("\n").length });
         from = index + symbol.length;
       }
```

With the guard flipped, a symbol that is *absent* yields `index === -1` on every pass: the loop never breaks, pushes a violation each time, and `from = -1 + symbol.length` never advances it out. Non-terminating, with unbounded memory growth. This is a `guard-flip: === → !==` — a mutation the verifier generates by design, not an authored defect.

## Why the corpus makes this likely, not exotic

The structural-invariant scanners are written as `let from = 0; while (true) { indexOf(...); if (index === -1) break; … }`. That shape appears across the `*-anchors` corpus (cli, daemon, execution-loop), and every one of those `=== -1` guards is a mutation candidate whose flip is non-terminating. The corpus is being actively expanded, so the exposure grows.

The runbook lists "subprocess hang" as a residual risk of diff-derived verification. This is that risk with a concrete, reproducible cause.

## Decisions

- Every verifier-launched killing-test subprocess runs under a hard wall-clock bound and is killed with its process group on expiry; rules out a single mutant holding a core and a run indefinitely.
- A mutant whose killing-test run exceeds that bound is reported as a distinct outcome — the mutant did not terminate — and is not silently equivalent to "survived" or "killed"; rules out a timeout being scored as evidence either way.
- The source file is restored on **every** exit path, including timeout, abort, and process death, before the verifier returns or the run settles; rules out leaving an inverted production guard in an operator-visible worktree.
- A worktree carrying an unrestored mutant is detectable — the verifier records the file, site, and mutation it currently has applied, so a wedged run's worktree can be diagnosed without reverse-engineering the diff; rules out an operator mistaking a mutant for agent work.
- Rules out fixing this only by rewriting the scanners' `while (true)` loops: the loop shape is legitimate, and the verifier must be safe against non-terminating mutants in general.

## Acceptance criteria

- [ ] A test proves a killing-test run that does not terminate is killed at a bounded wall clock rather than awaited indefinitely; it fails against the current unbounded wait.
- [ ] A test proves that timeout settles a distinct non-terminating-mutant outcome, separate from survived and killed; it fails against a binary classification.
- [ ] A test proves the mutated file is restored to its pre-mutation contents after such a timeout; it fails against the current restore-only-after-return path.
- [ ] A test proves a guard-flip on a `while (true)` exit condition is detected by that bound rather than hanging the suite — driven by the real `scanDaemonRunControlHandlerForbiddenSymbols` loop shape.
- [ ] A test proves the applied-mutation record identifies file, site, and mutation while a mutant is applied, and is cleared on restore.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — § Diff-derived mutation verification: the per-candidate wall clock, the non-terminating outcome, and the restore-on-every-path guarantee.
- `v2/docs/operator-runbook.md` — § Gate trust and § Concurrency: a hung verifier child presents as a `live` run with no agent; check the worktree for an unrestored mutant before reading a dirty guard as agent work.
- `v2/docs/v1-behaviors.md` — record bounded killing-test execution and guaranteed mutant restore.
