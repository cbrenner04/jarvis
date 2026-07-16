# 01 - A pushed completion without PR evidence is a publication failure

`publishCompletionArtifacts` in `v2/src/execution/write-loop.ts` never inspects
the publisher's result. A publisher that pushes and returns no `prNumber`
proceeds straight to ready finalization and the loop reports `complete` with exit
`0` — a pushed branch, no PR, no error. Subspec 00 closes the real publisher's
hole; this closes the boundary that decided the outcome, so the guarantee holds
for any publisher.

## Decisions

- Gate on the publisher result: `pushSha` present and PR evidence absent is a publication failure; rules out gating on config, which the boundary does not read, and keeps non-git completions (no push, no publication) untouched.
- Reuse the retryable `completion_commit_failed` outcome with a normalized `pr` cause; rules out a new outcome kind — the operator remedy (`run resume`, idempotent republish) is the existing one, and every consumer already maps this kind.
- Apply the same gate on the workflow-runner publication boundary; rules out fixing standalone runs only and leaving workflow completions silently unpublished.
- Test seams returning an empty publisher result stay valid — the gate needs `pushSha`; rules out a blanket "evidence required" check that would fail every stub-publisher test for reasons unrelated to publication.

## Acceptance criteria

- [ ] A write-loop test with a publisher that returns a `pushSha` and no PR evidence ends the run at retryable `completion_commit_failed` with a normalized `pr` cause instead of `complete`/exit `0`; it fails against the pre-fix code.
- [ ] The same publisher through the workflow-runner publication boundary yields the same failure outcome rather than a completed workflow.
- [ ] Ready finalization does not run when PR evidence is missing: no gate, no draft→ready flip.
- [ ] A completion that pushes nothing (git-disabled workflow) still completes without publication.
- [ ] `write-loop.test.ts` and `workflow-runner.test.ts` completion and publication-failure tests stay green (gate is additive to those paths).

## Documentation updates

- `v2/docs/write-behavior.md` — a pushed completion reports success only after a confirmed PR; missing evidence is a retryable publication failure and skips finalization.
- `v2/docs/operator-runbook.md` — what `completed` now guarantees for gate and publication.
- `v2/docs/v1-behaviors.md` — record the changed v2 publication guarantee.
