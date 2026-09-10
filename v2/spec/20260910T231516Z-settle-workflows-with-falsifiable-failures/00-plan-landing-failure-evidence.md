# Plan-tree landing failures carry falsifiable evidence

## Problem

`landPlanTree`'s shape checks in `v2/src/execution/publication-landing.ts` throw bare message strings (`plan: unlinked_numbered_subspec: <file>: <observation>`, `plan: staged spec tree has invalid shape`). The operator gets a verdict with no expectation, and the two unlinked-subspec cases — an index that mentions the file without a parseable checkbox link, versus an index with no candidate line at all — collapse into one `unlinked_numbered_subspec` verdict whose repairs are opposite. Paths in the text mix the Jarvis-owned `.jarvis-plan-stage` sidecar with the operator's durable spec directory, leaving renderers to infer ownership.

## Decisions

- Plan-landing check failures throw an error carrying an `OperatorFailureRecord` (`shared/operator-failure-record.ts`) alongside the existing message; the message text stays so current `toThrow` assertions and log traces keep working.
- The unmatched-candidate case records the mentioning index line as `nearMiss`; the no-candidate case sets no `nearMiss` and says so in `observation`; rules out one absent verdict prescribing opposite repairs.
- `retryable: false` for every plan-tree shape-check failure at this settlement: since `admitPlanRecoveryBlockerAndClaim`'s direct-landing recovery (`workflow-runner-resume.ts`) re-validates and re-lands the same on-disk staged bytes without dispatching a role, an unmodified reissue re-fails identically; rules out `landing_failed`'s `nextAction: resume` advertising a fixed point as recoverable. This value is the one predicate feeding both the record's `retryable` and the existing hardcoded `resumable: true` on the `landing_failed` `loop_finished` event and returned result — one computed value, not two verdicts on the same row.
- Path origin attaches per branch, since no single `landPlanTree` failure can name both paths except the conflict check: normal-branch (`stagingDir` present) shape-check failures — missing/invalid-shape, unlinked-subspec — carry only the staging path, `harness-internal`; the staging-absent recovery branch's `planFiles(durablePath)` failures carry only the durable path, `operator-repository`; the "file already exists with different contents" conflict compares both files and carries both paths with their respective origins. Rules out presentation code classifying Jarvis staging as operator code, and rules out one failure asserting an origin pair it cannot observe.
- The runner's landing settlement in `v2/src/execution/workflow-runner.ts` persists the record when the thrown error carries one, and settles unchanged otherwise; rules out widening this subspec into a general runner settlement rewrite (that is subspec 02).
- Out of scope: `checkPlanTreeLanding`'s recovery-path revalidation flattens the thrown error via `errorMessage(error)` before this record reaches it, losing the near-miss and origin distinctions; unchanged by this subspec. Also out of scope: the reviewed-workflow debate-landing fallback (`workflow-runner-debate-landing.ts`'s generic `resumable: true`), which settles landing kinds other than plan-tree and is not touched here.

## Task checklist

- [ ] Add the record-carrying landing error and populate it at each plan-tree shape check, attaching origin per branch.
- [ ] Thread the record into the `landing_failed` terminal settlement, replacing the hardcoded `resumable: true` with the record's `retryable`.
- [ ] Tests and docs.

## Acceptance criteria

- [ ] `v2/src/execution/publication-landing.test.ts` proves an unlinked numbered subspec whose index mentions it reports an unmatched near-miss index line, distinct from an index with no candidate line, which reports no near miss; it fails against the pre-fix single `unlinked_numbered_subspec` message.
- [ ] `v2/src/execution/publication-landing.test.ts` proves a normal-branch (staging present) shape-check failure carries only the staging path with `harness-internal` origin, and a staging-absent recovery-branch failure (`planFiles(durablePath)`) carries only the durable path with `operator-repository` origin; it fails against the pre-fix plain strings.
- [ ] `v2/src/execution/publication-landing.test.ts` proves the "file already exists with different contents" conflict carries both the staging path (`harness-internal`) and the durable path (`operator-repository`); it fails against the pre-fix plain string.
- [ ] `v2/src/execution/workflow-runner-publication.test.ts` proves a plan-landing failure settles the run with a populated `operatorFailureRecord` whose `retryable` is `false`, matching the settlement's `loop_finished.resumable`; it fails against the pre-fix verdict-only landing settlement advertising `resume`.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — operator-facing failures state expectation and observation rather than a bare verdict, with the near-miss and path-origin rules.
- `v2/docs/workflow-runner.md` — plan-landing settlement producer contract.
- `v2/docs/v1-behaviors.md` — record the changed plan-landing settlement evidence.
