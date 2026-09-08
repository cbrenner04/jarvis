---
name: pipeline-recover-resolves-past-approval-gates
---

# `pipeline recover` discards the operator's correction and revalidates the agent's original draft

## Problem

`jarvis pipeline recover` exists for exactly one job the runbook documents: land a hand-corrected blocked plan stage **without redrafting it**, as distinct from `pipeline resume`, which "reopens the row and redispatches the stage through its ordinary write step — it redrafts, discarding the correction."

It does not do that job. Recover admits, then overwrites the operator's corrected `.jarvis-plan-stage/` with the agent's original draft before revalidating, and reports a failure against that restored draft. The correction never participates. Every documented step of the recovery procedure runs, and the operator's work is silently thrown away.

## Evidence (2026-09-08, pipeline `443a6cd9`, lane `stamp-gate-commands-on-gate-running-steps`)

The plan stage blocked `contract_miss`: `Plan split left forbidden lineage for daemon`. **The gate was correct.** The ready-intent declares one surface ("Module-boundary surface: CLI workflow admission"), and the agent split it into `00-daemon.md` (well-formed, but misnamed for a daemon surface the work never touches — it is entirely `v2/src/commands/`) plus a vacuous `01-cli.md` with empty `## Decisions`, empty `## Acceptance criteria`, empty `## Documentation updates`, and a `## Task checklist` copy-pasted from `00`. That is precisely recover's use case.

Following the runbook procedure verbatim — correct the staged tree by hand, then recover:

1. Renamed `00-daemon.md` → `00-cli-workflow-admission.md`, deleted the vacuous `01-cli.md`, rewrote `index.md` to link the single subspec. Verified on disk.
2. `jarvis pipeline recover 443a6cd9-… stamp-gate-commands-on-gate-running-steps` → exit `0`, `{"kind":"admitted",…}`.
3. Stage settled `failed` with `{"code": "plan_stage_invalid", "message": "MD012: Multiple consecutive blank lines … (.jarvis-plan-stage/00-daemon.md)"}` — naming the file that no longer existed when recover was invoked.
4. The stage directory afterward held `00-daemon.md` and `01-cli.md` again, with fresh mtimes and different byte sizes than the pre-correction draft, and `index.md` reverted to linking both.

Ruling out the obvious alternatives: `.jarvis-plan-stage/` is **gitignored** (`.gitignore:14`), so no git reset could have reverted it; `jarvis run list --branch plan/stamp-gate-commands-on-gate-running-steps` shows exactly **one** run row (`3e4fc382`, `blocked`), so no second run row explains the rewrite; and that run's log has no iteration after the original `loop_finished contract_miss`. The restore happened inside the recover path itself.

MD012 is a real lint violation *of the restored draft* — the vacuous `01-cli.md`'s empty sections produce consecutive blank lines — which is a second signal that the draft under validation was the agent's, not the operator's.

## Correction to this seed's prior premise

This seed previously recorded that recover **refuses every time** on `full-review` with `stage_resolution_failed: stage "plan" has no preceding workflow artifact`, because resolution read position `n-1` (the approval gate) instead of walking back to the nearest workflow stage. **That no longer reproduces** — recover admitted on a `full-review` plan stage sitting directly behind an `approve-intent` gate. Treat the resolution half as closed and re-verify before reopening it; the live defect is the discarded correction.

## Decisions

- Recover revalidates the staged tree **as it exists on disk at invocation**; rules out restoring, re-materializing, or re-deriving the stage contents from any durable snapshot, which is what makes recover indistinguishable from `resume`.
- Recover never invokes the stage's write step or any agent role; rules out redrafting under a verb whose documented contract is "land it as-is".
- A validation failure names the file and content actually validated; rules out reporting a violation against a path the operator deleted before invoking.
- If recover cannot validate the on-disk tree for a structural reason (missing `index.md`, unreadable file), it refuses **before** mutating the stage directory and leaves the operator's tree intact; rules out destroying a correction on the failure path.

## Acceptance criteria

- [ ] A test corrects a blocked plan stage's staged tree on disk (rename a subspec, delete a sibling, rewrite `index.md`), runs recover, and proves the stage directory afterward holds exactly the corrected files; it fails against the current restore-then-validate path.
- [ ] A test proves recover's settled `failureDetail` names a path present in the operator's corrected tree, never one deleted before invocation.
- [ ] A test proves recover invokes no agent role — no write-step dispatch, no new run row, no additional `iteration_started` on the blocked run.
- [ ] A test proves a structurally invalid on-disk tree refuses without mutating the stage directory.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — recover validates the on-disk staged tree; it neither restores nor redrafts.
- `v2/docs/operator-runbook.md` — the hand-correct-then-recover procedure works; drop the note that `resume` is the only path for a blocked `full-review` plan stage, and record that the prior `stage_resolution_failed` refusal no longer reproduces.
