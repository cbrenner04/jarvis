# Verdict — Refinements Required

The spec's foundation is sound; the issues below are precision and honesty edits, plus one genuine content gap (01's scope boundary). Refine the spec to address each.

## Subspec 00 — Serial-retry the ready gate

1. **Soften the "no false-pass" guarantee.** The claim that serial-retry carries zero false-pass risk is overstated. A genuine *concurrency* defect (race, shared-state leak, PID reuse) can fail under `--parallel` and pass serially — the gate would then reclassify a real defect as a flake and go green. This is exactly the failure mode the intent cites ("misdiagnosed a real regression as flaky"), now automated. The guarantee is true only for *parallel-invariant* failures. Restate the decision honestly: serial re-run cannot mask a parallel-invariant failure; a genuine parallelism-dependent defect that passes serially is the known, accepted residual (it mirrors the operator's manual procedure the intent endorses). Do not claim a proof the design doesn't have.

2. **Exclude interrupt/timeout exit codes from the retry trigger.** The trigger fires on *any* non-zero test exit, but non-zero also covers deadline-kill and SIGINT/SIGTERM. A deadline kill yields a guaranteed-useless instant second kill; an operator Ctrl-C should abort, not launch a serial re-run (a behavior regression). Add a decision pinning that serial-retry fires only on a genuine test-process failure exit, excluding timeout- and signal-derived codes.

3. **Pin the test-step detection predicate.** "Detect the test step failure" leaves the load-bearing gating condition to the implementer, and `check`/`check:fix`/`typecheck` also run via `bun run`. State the matching rule as a decision so it cannot accidentally match a non-test step.

4. **Constrain the serial command to identical discovery.** State that the serial re-run is exactly `bun test` with no path/filter args — same test-set discovery as the parallel run, only `--parallel` dropped — to foreclose an implementer adding a divergent serial subset.

5. **Make flake-recovery logging an acceptance criterion.** The "log the serial re-run" task item has no AC, so it goes untested. Promote it, and specifically require an operator-visible signal on serial-green (the masked-flake-recovered case is the most valuable to surface).

6. **Add an AC for deadline-during-serial-rerun.** The decision routes the serial run through the shared deadline (correct), but no AC pins the consequence: a serial re-run that exceeds the remaining deadline is killed and the gate exits non-zero (fail-closed, no special-casing).

## Subspec 01 — Determinism convention

7. **Define "agent-runnable test."** This scope term is the entire boundary of the convention yet is never defined. Real OS APIs (`reap.ts` `listProcesses`/`kill`) must be exercised by *something*, and the intent presupposes a legitimate class of real-process tests ("removes any need for a per-spec needs-unsandboxed escape hatch"). The convention must define which tests it governs and state where legitimate real-process tests live or how they're marked. Without this the convention is unenforceable.

8. **Declare enforcement an explicit non-goal.** The deliverable is documentation only, with no lint/review hook. State that automated enforcement is out of scope (deferred) rather than leaving the intent's "written deterministic from the start" promise implicitly resting on authors reading the doc.

## Index / scope

9. **State the existing-tests scope boundary explicitly.** Neither subspec converts the existing process-spawning tests that "can't run in the sandbox at all" — the intent's headline motivating example. 00 covers *new* parallel flakes; 01 prevents *new* non-deterministic tests. This is defensible scoping (full conversion is a separate effort inheriting #15's pattern incrementally), but a reader will expect the headline example closed. Add a one-line note (index or 01) scoping out conversion of existing un-runnable tests.

## Not defects (no action)

- Whole-suite serial re-run over parsed-subset, single re-run vs. loop, and shared-deadline accounting are sound and well-justified — leave them.
- Fast-tier serial-green with no remaining command is correct by construction.
- Doc home (`v1-behaviors.md`) is defensible and matches intent; the author should sanity-check for a more specific shared-tooling doc but no change is mandated.