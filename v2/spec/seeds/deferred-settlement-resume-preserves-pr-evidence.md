---
name: deferred-settlement-resume-preserves-pr-evidence
---

# Resume-driven deferred settlement preserves the stage's PR evidence so the terminal action succeeds

## Problem

When `pipeline resume` drives a stage out of the `settlement_deferred` (`entry_run_still_live`) wedge (the [[pipeline-resume-drives-deferred-settlement]] recovery, #3012), it settles the stage `succeeded` but records the stage artifact **without `prNumber`/`prUrl`**, even though the stage's implement run already created a draft PR and pushed the branch. The terminal action then fails: `terminalPublicationFailure {operation: "ready", message: "PR evidence required: prNumber and prUrl must be present"}`, and the whole pipeline settles `failed` despite every stage showing succeeded and a green, mergeable PR existing. The work is done and the PR is real; only the resume-settlement path drops the evidence the terminal `ready`/`merge` action needs.

## Evidence (2026-08-28)

`full-review` pipeline `d81de659` on the jarvis repo (seed `pipeline-stage-run-join-resolves-entry-run-id`): implement stage wedged `settlement_deferred` for ~40 min after entry run `7b2d6dad` was already terminal, with no live runs. `jarvis pipeline resume d81de659` settled it — implement stage `succeeded`, `failureDetail: null`, artifact `{entryRunId, specPath}` with no PR fields. Draft PR **#3034** existed (branch pushed, ready-gate commit present, CI green, mergeable). Pipeline settled `failed` on `terminalPublicationFailure {operation: "ready", "PR evidence required: prNumber and prUrl must be present"}`. Operator hand-finished by retargeting/merging #3034.

## Decisions

- The resume-driven settlement path carries the stage's already-published PR evidence (`prNumber`/`prUrl`) into the settled artifact when the implement run published one before the defer. Rules out settling `succeeded` with a PR-less artifact.
- If the PR was never published before the defer (genuinely no branch/PR), resume's settlement completes publication (push + PR create) before the terminal action, or records a publication failure naming the missing step — not a bare "PR evidence required" at the terminal action. Rules out the terminal action being the first place the missing PR surfaces.
- The terminal `ready`/`merge` action reads PR evidence from the settled artifact as today; the fix is upstream, in what resume records. Rules out relaxing the terminal action's evidence requirement.

## Acceptance criteria

- [ ] A resume/settlement test proves a stage wedged `settlement_deferred` whose implement run already published a PR settles `succeeded` with `prNumber`/`prUrl` on the artifact, and the terminal action succeeds; it fails against the current path that drops the evidence.
- [ ] A test proves a deferred stage with no published PR either completes publication on resume (artifact gains PR evidence) or records a publication-step failure — not a terminal `"PR evidence required"` on an otherwise-succeeded stage.
- [ ] A test proves the terminal `ready` action succeeds when the settled artifact carries PR evidence and fails cleanly (named) when it genuinely does not.
- [ ] `bun run typecheck` and `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Pipeline resume: note that resume preserves published PR evidence so the terminal action lands; cross-link [[pipeline-resume-drives-deferred-settlement]].
- `v2/docs/v1-behaviors.md` — resume-driven deferred settlement carries PR evidence into the settled stage artifact.
