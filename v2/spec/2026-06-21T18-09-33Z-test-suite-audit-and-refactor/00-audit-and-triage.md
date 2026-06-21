# 00 - Audit and triage the corpus

## Problem

`*.test.ts` files matching process/timing primitives (`spawn`, `execFile`, `exec`,
`setTimeout`, `Date.now`, `sleep`, `new Date(`) need triage. A raw match is not a smell — most
already inject/mock the spawn import and never touch a real OS process. The refactor needs a
fixed work-list so later subspecs don't blindly rewrite already-deterministic tests, and the
determinism convention needs an enforceable smell checklist so new tests don't regress.

The prerequisite convention (`flaky-tests-serial-retry-and-determinism`) already supplies the
determinism *rules* (no real spawn / wall-clock, DI seams) and the serial-retry gate. This
subspec adds the *smell checklist* on top — the per-file diagnostic taxonomy used to triage and
to guard new tests — and the triage artifact. It does not restate or re-own the rules.

This subspec is audit-only: it produces the triage and codifies the checklist. No test files
are refactored here.

## Decisions

- Classify each candidate into exactly one verdict: `already-deterministic` (mocks/injects, no
  real OS process or wall-clock), `refactor` (genuine spawn/clock/ordering smell), or
  `marked-exception` (genuinely needs a real OS/git seam → rename to `.sandbox-unrunnable.test.ts`). Rules out blindly rewriting every matching file.
- A test that uses a real OS process/git but is *deterministic* (not flaky) is `marked-exception`, **kept not mocked** — mocking working integration coverage is itself the over-mocking smell the intent targets. `already-deterministic` means deterministic *and* no real OS process; deterministic-but-real-process is not that bucket. Rules out a fourth verdict and rules out destroying integration coverage.
- "Suite stays green" is measured **sandbox-off** (the environment where `.sandbox-unrunnable.test.ts` files run); there is no runner-exclusion wiring today, so marked-exception files are expected to pass under a sandbox-off `bun test`, not excluded. Rules out an in-sandbox green claim that silently can't run the marked files. This is the green basis 01–05 inherit.
- Triage scope = the primitive-matching files surfaced by the recorded scan, plus a re-scan to catch any the regex missed; record the scan command so the work-list is reproducible.
- A matching file may be closed as `already-deterministic` with no cluster assignment (e.g. `test/test-slices.test.ts` under `test/`, which no 01–05 cluster covers). Only `refactor`/`marked-exception` files need a cluster. Rules out forcing a cluster onto a cleared file.
- Capture a lightweight coverage baseline in `findings.md`: for each `refactor`/`marked-exception` target, an inventory of its distinct behavior assertions (and coverage numbers if the runner emits them) so 05 can check no-net-coverage-loss against a concrete artifact. Rules out an unfalsifiable preservation claim.
- Also flag redundancy (duplicate coverage) and slow tests per file, since the refactor subspecs merge/drop those. Rules out a spawn-only audit that misses the intent's other smell categories.
- Codify the smell *checklist* as durable guidance in `v2/docs/test-writing.md`, not only in the triage artifact. Rules out a transient findings doc that can't prevent regressions.
- Triage artifact lives at `findings.md` in this spec dir as generated evidence; the durable contract is the test-writing.md checklist. Rules out scattering audit state into production docs.

## Task checklist

- [ ] Re-scan `v1`/`v2`/`shared`/`test` for the primitive patterns; record the scan command and let it produce the count.
- [ ] For each candidate, record path, primitive(s), verdict, and (if `refactor`) the seam/clock to inject and target cluster subspec (01–05); `marked-exception` files record the OS/git seam they require.
- [ ] Capture the per-target assertion-inventory + coverage baseline.
- [ ] Flag redundant/slow tests per file.
- [ ] Write `findings.md` as the work-list consumed by 01–05.
- [ ] Add a determinism smell checklist to `v2/docs/test-writing.md` and strike/rewrite its "Out of scope" clauses that disavow converting existing tests (R1).

## Acceptance criteria

- [ ] `findings.md` exists and assigns every primitive-matching `*.test.ts` file under `v1`/`v2`/`shared`/`test` exactly one verdict (`already-deterministic`/`refactor`/`marked-exception`), with the reproducible scan command recorded; the file count comes from the scan, not a pre-stated guess.
- [ ] Each `refactor`-verdict file names its target cluster subspec (01–05) and the DI seam or injected clock to apply; each `marked-exception` names the OS/git seam it requires. A deterministic real-process/git test is recorded `marked-exception` (kept, not mocked), never `already-deterministic`. An `already-deterministic` file needs no cluster.
- [ ] `findings.md` records the green basis (suite measured sandbox-off; marked-exception files run, not excluded) and a per-target assertion inventory (+ coverage numbers if emitted) as the baseline 05 checks for no-net-coverage-loss.
- [ ] `findings.md` lists any redundant or slow tests flagged for merge/drop, or states none found.
- [ ] `v2/docs/test-writing.md` contains a determinism smell checklist covering real process spawn, wall-clock/timing dependence, ordering/parallelism sensitivity, redundancy, and slow tests; and its "Out of scope" section no longer disavows converting existing tests.
- [ ] No `*.test.ts` source file is modified by this subspec; `bun run test` and `bun run typecheck` pass.

## Documentation updates

- `v2/docs/test-writing.md`: add the determinism smell checklist (new-test regression guard); strike or rewrite the "Out of scope" clauses ("Converting existing tests", "Existing real-process tests … out of scope to convert") so the durable convention no longer contradicts the conversion work this spec performs.
