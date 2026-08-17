# Recover plan-stage admission and review continuation

## Problem

A stopped plan run with a corrected populated stage has no deliberate, identity-safe path forward when generic resume is unavailable, so operators must redraft and lose their correction.

## Decisions

- Recovery is an operator-reachable request naming one stopped plan run. It selects that run's persisted plan workflow step, captured plan context, worktree, branch, and `.jarvis-plan-stage/`; each must still identify the same run and checkout. Refuse `missing_plan_context`, `stage_identity_mismatch`, or `unrelated_plan_stage` when the corresponding persisted relationship is absent or disagrees.
- A populated stage from `contract_miss` or `blocked` is recoverable even when that run reports `resumable: false`; ordinary resume admission and its meaning remain unchanged.
- Recovery runs only in Git-backed publication mode. In Git-disabled mode it refuses `recovery_requires_git` before drafting, review, landing, or input consumption and retains the stage and ready-intent.
- Recovery removes only the exact trailing `## Blocker` captured as harness-authored metadata for the selected stopped attempt, before validation and publication. A missing, changed, non-trailing, or otherwise unmatched blocker is operator-authored: retain it and refuse `operator_blocker` rather than silently deleting or publishing it.
- Once admitted, recovery never invokes plan drafting. It runs the captured remaining review actuators, with the normal revalidation barriers, then delegates to the shared landing and completion-publication tail.

## Tasks

- Add an operator recovery request that resolves one stopped plan run and verifies its persisted context, stage, worktree, and branch identity before any effect.
- Admit corrected `contract_miss` and `blocked` stages independently of ordinary resumability, remove only proven harness blocker metadata, and retain all other stages and inputs on refusal.
- Bypass plan drafting and continue the captured review sequence; explicitly refuse Git-disabled recovery.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` test `recovers an operator-edited plan stage through publication without redrafting` settles a plan draft with an out-of-union `## Decisions` contract miss and `resumable: false`, corrects its staged subspec, invokes the recovery request for that stopped run, proves the configured remaining review runs, corrected bytes reach the configured durable spec tree, the ready-intent is consumed, and the draft binding is not invoked during recovery; it fails against the pre-fix code and contains the headline-revert `// @mutate` directive. `v2/src/execution/workflow-runner.test.ts` — `recovers an operator-edited plan stage through publication without redrafting`; Keystone checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `recovers an operator-edited plan stage through publication without redrafting` contains unique source directives that invert every draft-bypass guard and make its scoped test red. `v2/src/execution/workflow-runner.test.ts` — `recovers an operator-edited plan stage through publication without redrafting`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `admits corrected plan stage despite a non-resumable stop` covers populated `contract_miss` and `blocked` stages, proves recovery accepts both despite `resumable: false` while ordinary resume eligibility is unchanged, and fails against the pre-fix code; its unique source directives invert every recovery-admission guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `admits corrected plan stage despite a non-resumable stop`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `refuses recovery with missing or mismatched plan context` covers missing captured context, run/step or stage identity mismatch, and an unrelated populated stage; each refusal names its outcome and performs no drafting, review, landing, or consumption; its unique source directives invert every context-identity guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `refuses recovery with missing or mismatched plan context`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `retains operator blockers and removes only captured harness blockers during recovery` proves a stale matching harness `## Blocker` neither rejects a corrected stage nor reaches durable output, while changed or operator-authored blockers are retained and refuse `operator_blocker`; its unique source directives invert every blocker-provenance guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `retains operator blockers and removes only captured harness blockers during recovery`; Mutation checkpoint:
- [ ] `v2/src/execution/workflow-runner.test.ts` test `refuses Git-disabled plan-stage recovery` reports `recovery_requires_git`, preserves the stage and ready-intent, and invokes neither draft, review, landing, nor publication hooks; its unique source directives invert every Git-mode refusal guard and make the scoped test red. `v2/src/execution/workflow-runner.test.ts` — `refuses Git-disabled plan-stage recovery`; Mutation checkpoint:

## Documentation updates

- `v2/docs/workflow-runner.md` — document the recovery request and stopped-run identity checks, `resumable: false` distinction, Git-disabled refusal, captured-harness-blocker handling, and continuation without drafting.
- `v2/docs/v1-behaviors.md` — record additive v2 recovery of a corrected plan stage without redrafting.
