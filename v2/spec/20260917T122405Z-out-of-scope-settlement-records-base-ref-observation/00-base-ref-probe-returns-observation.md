# Base-ref probe returns its observation

A conclusive base-ref `fail` carries no evidence of what the probe saw, so nothing downstream can record it.

## Decisions

- `BaseRefProbeResult`'s (`v2/src/execution/ready-finalize.ts`) conclusive fail outcome changes from the bare string `"fail"` to `{ kind: "fail"; pass: number; fail: number; baseCommit: string }` — rules out a bare-string shape that carries no evidence.
- `pass`/`fail` counts come from bun's per-test reporter lines (count of lines matching `(pass)`/`(fail)`, the same evidence `hasFailingTestEvidence` already anchors on), not bun's aggregate summary line, which can disagree with the per-test lines. A conclusive fail still requires `fail >= 1`, the same gate `hasFailingTestEvidence` already enforces.
- `classifyBaseRefProbeFailure` computes the counts from the probe's captured output. `createDefaultReproduceReadyGateAtBaseRef` is the only caller that already resolves and verifies `baseCommit`; it attaches `baseCommit` to the returned fail outcome there — the commit is captured once, at verification, and never re-derived downstream.
- `pass` and inconclusive (`error`) outcomes keep their existing shape; only the exonerating `fail` outcome carries an observation.
- Every existing seam stub in `ready-finalize.test.ts` that returns bare `"fail"` from `reproduceReadyGateAtBaseRef` is updated to the new object shape (a fixed placeholder observation where the test doesn't care about its values).
- `ReadyGateClassification`'s `ready_gate_out_of_scope` gains `outsidePathObservations?: Record<string, { pass: number; fail: number; baseCommit: string }>` keyed by path, alongside `outsidePaths`. `ReadyGateError` carries the same field. Which classification kind is returned does not change.

## Acceptance criteria

- [x] A new test in `v2/src/execution/ready-finalize.test.ts` drives `classifyReadyGateFailure` through a conclusive base-ref failure (a seam stub returning the new `{ kind: "fail", pass, fail, baseCommit }` shape) and asserts the out-of-scope classification's `outsidePathObservations` carries, per path, the pass/fail counts and verified base commit; it fails against the pre-fix code.
- [x] Existing classification tests in `v2/src/execution/ready-finalize.test.ts` stay green after their seam stubs are updated to the new fail shape (outcomes unchanged).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- None: internal shape; the operator-facing record is documented in 01.
