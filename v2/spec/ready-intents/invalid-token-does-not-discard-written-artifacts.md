---
name: invalid-token-does-not-discard-written-artifacts
---

# A step with satisfied artifacts is not discarded for a missing token

`write-loop.ts:582` maps `invalid_token` to
`{ kind: "invocation_failure", runStatus: "failed" }`, and the loop finishes
`resumable: false`. Runs that wrote correct artifacts to disk are recorded as failed
and stranded outside git; the only recovery is hand-salvaging the worktree or paying
for the whole draft again.

When the terminal token is absent, consult the artifact contract that the step
already checks (`expectedArtifactPath` / `artifact.exists`, `write.ts:214`) and
decide the outcome from it. An artifact that satisfies the contract must not produce
a discarded run. If the outcome still cannot be determined, `invalid_token` must not
imply `resumable: false` while artifacts are on disk — the run stays resumable with
the artifacts intact.

Observable: the reproduced `plan` / `plan-reviewed-light` run whose spec tree exists
on disk no longer ends `failed` / `resumable: false`.

## Prerequisites

## Documentation updates

- `v2/docs/write-behavior.md` — artifact-decided outcome and resumability on a missing token.
- `v2/docs/operator-runbook.md` — remove the manual worktree-salvage workaround.
