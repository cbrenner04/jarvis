---
name: plan-review-failure-preserves-and-recovers-the-good-draft
---

# A plan whose write step produced a valid draft but whose review step failed strands the draft — no non-destructive recovery

## Problem

When a `plan` stage's write step produces a valid, normalizer-passing draft but the **review** step then fails — e.g. the review agent stalls (`role_stalled`) or hits quota/invocation failure — the whole plan stage settles `failed` with `harness_failure` (`retryable: false`, `nextAction: stop`), and the good staged draft has no non-destructive recovery path:

- `jarvis pipeline resume <id> [<branch>]` reopens the stage and **redispatches the plan write step** — it redrafts from scratch, discarding the draft the write step already produced, and if the failure recurs (a review that reliably stalls on that content) it loops.
- `jarvis pipeline recover <id> <branch>` **refuses**: `stage_resolution_failed: pipeline-stage-resolve: stage "plan" has no preceding workflow artifact`. `recover` is built for a *blocked* plan stage (`contract_miss`/`agent_blocked` with a staged tree), not a `failed`/`harness_failure` stage, so it cannot revalidate-and-land the good draft either.

So a transient or content-specific review failure throws away completed drafting work. Worst on pipelines with review, where the review step is the fragile part but the write step's output is fine.

Observed 2026-08-24 dogfooding a `full-review` pipeline on the jarvis repo (pipeline `0f0b45d9`, seed `pipeline-recover-lands-fan-out-lanes`): the plan write step produced a complete, valid `.jarvis-plan-stage/` tree on every attempt, but the **debate review** step stalled `role_stalled` → `harness_failure` on **3 consecutive attempts** (twice under CPU contention, once in full isolation). `pipeline resume` redrafted each time; `pipeline recover default` refused (`no preceding workflow artifact`). The good draft was ultimately hand-published to land the work.

## Decisions

- A plan stage whose **write step succeeded** (valid staged draft) but whose **review step failed** must preserve the staged draft and offer a non-destructive recovery that revalidates/re-reviews the existing draft rather than redrafting it. Rules out the current behavior where the only lever (`resume`) discards a good draft. Pick one (or both) of:
  - Make the review-step failure **retryable at the review step only** — re-run the review against the existing staged draft (preserving it), instead of settling the whole stage non-retryable `harness_failure`.
  - Let **`pipeline recover`** reach a `failed`/`harness_failure` plan stage whose staged tree is intact and revalidate-and-land it (the same as it does for a `blocked` stage), instead of refusing with `no preceding workflow artifact`.
- A review that reliably fails on specific content must not become an infinite redraft loop; after preserving the draft, surface it for operator revalidation/hand-review rather than silently retrying forever. Rules out `resume`-redraft as the sole path.
- Do not change behavior when the write step itself failed (no valid draft to preserve). Rules out masking genuine draft failures.

## Acceptance criteria

- [ ] When a plan stage's write step produced a valid staged draft and the review step then fails (stall/quota/invocation), the staged draft is preserved (not discarded) and the stage is recoverable without redrafting — pinned by a test seeding a succeeded-write + failed-review plan stage and asserting the staged tree survives and a recovery verb revalidates it (fails against the current redraft-only behavior).
- [ ] `jarvis pipeline recover <id> <branch>` no longer refuses a `failed`/`harness_failure` plan stage whose staged tree is intact with `no preceding workflow artifact`; it revalidates and lands the existing draft — pinned by a test (fails today).
- [ ] A write-step failure (no valid draft) is unaffected — pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — recovery section: a plan stage that fails only at review preserves the draft and is recoverable via `pipeline recover` (or the review retry); clarify `resume` redrafts vs `recover` revalidates for this case.
- `v2/docs/daemon-host.md` — review-step failure handling and the recover path for a review-failed plan stage with an intact staged tree.
