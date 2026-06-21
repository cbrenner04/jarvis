# 00 - Audit and triage the corpus

## Problem

~35 of 87 `*.test.ts` files match process/timing primitives (`spawn`, `execFile`, `exec`,
`setTimeout`, `Date.now`, `sleep`, `new Date(`). A raw match is not a smell — most already
inject/mock the spawn import and never touch a real OS process. The refactor needs a fixed
work-list so later subspecs don't blindly rewrite already-deterministic tests, and the
determinism convention needs an enforceable smell checklist so new tests don't regress.

This subspec is audit-only: it produces the triage and codifies the checklist. No test files
are refactored here.

## Decisions

- Classify each candidate into exactly one verdict: `already-deterministic` (mocks/injects, no
  real OS process or wall-clock), `refactor` (genuine spawn/clock/ordering smell), or
  `marked-exception` (genuinely needs real OS seam → rename to `.sandbox-unrunnable.test.ts`). Rules out blindly rewriting all 35.
- Triage scope = the 35 primitive-matching files plus a re-scan to catch any the regex missed; record the scan command so the work-list is reproducible.
- Also flag redundancy (duplicate coverage) and slow tests per file, since the refactor subspecs merge/drop those. Rules out a spawn-only audit that misses the intent's other smell categories.
- Codify the smell taxonomy as a checklist in `v2/docs/test-writing.md` (durable), not only in the triage artifact. Rules out a transient findings doc that can't prevent regressions.
- Triage artifact lives at `findings.md` in this spec dir as generated evidence; the durable contract is the test-writing.md checklist. Rules out scattering audit state into production docs.

## Task checklist

- [ ] Re-scan `v1`/`v2`/`shared`/`test` for the primitive patterns; reconcile against the 35-file inventory.
- [ ] For each candidate, record path, primitive(s), verdict, and (if `refactor`) the seam/clock to inject and target cluster subspec (01–05).
- [ ] Flag redundant/slow tests per file.
- [ ] Write `findings.md` as the work-list consumed by 01–05.
- [ ] Add a determinism smell checklist to `v2/docs/test-writing.md`.

## Acceptance criteria

- [ ] `findings.md` exists and assigns every primitive-matching `*.test.ts` file under `v1`/`v2`/`shared`/`test` exactly one verdict (`already-deterministic`/`refactor`/`marked-exception`), with the reproducible scan command recorded.
- [ ] Each `refactor`-verdict file names its target cluster subspec (01–05) and the DI seam or injected clock to apply; each `marked-exception` names the OS seam it requires.
- [ ] `findings.md` lists any redundant or slow tests flagged for merge/drop, or states none found.
- [ ] `v2/docs/test-writing.md` contains a determinism smell checklist covering real process spawn, wall-clock/timing dependence, ordering/parallelism sensitivity, redundancy, and slow tests.
- [ ] No `*.test.ts` source file is modified by this subspec; `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/test-writing.md`: add the determinism smell checklist (new-test regression guard).
