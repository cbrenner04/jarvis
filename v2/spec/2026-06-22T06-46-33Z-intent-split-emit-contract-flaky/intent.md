---
name: intent-split-emit-contract-flaky
---
# Intent split intermittently violates its own emit contract (missing `name:` frontmatter)

## Problem

`jarvis1 intent` tells the splitter (opus) to emit each ready-intent with `name:` frontmatter
matching the filename and a `## Prerequisites` section (`v1/src/modes/plan/intent-split.ts:56-59`),
then `validateIntentStage` (`v1/src/commands/intent.ts:252-270`) hard-rejects the run if any emitted
file misses them. The splitter complies **only intermittently** — observed this session failing on
seed 1 (1st attempt) and seed 5 (2 attempts), each costing a full opus intent run (~$1.50) before a
retry happened to comply. Pure model-compliance flake; nondeterministic and wasteful.

## Direction

Make the emit contract robust instead of re-rolling the model. Options (pick/compose):

- **Harness post-processing**: if an emitted file is missing `name:`/`## Prerequisites` but is
  otherwise a valid single intent, the harness fills them deterministically (name from filename, empty
  Prerequisites) rather than failing the whole run. The contract is mechanical — the harness can
  enforce it without re-running the agent.
- **Repair-in-place retry**: on a validation miss, re-prompt only to fix the frontmatter/section on
  the offending file, not re-run the whole split.
- **Single-behavior fast path**: when the seed is already one behavior, intent is a 1:1 passthrough —
  the harness can emit the ready-intent (seed body + `name:` from filename) directly without a model
  turn at all. (Operationally, the overlord now skips intent for single-behavior seeds and plans the
  seed directly; this would make intent itself reliable for that case.)

## Out of scope

- The multi-behavior split judgment itself (that genuinely needs the model).

## Documentation updates

- `v1/docs/intent-mode.md` — note the harness-enforced (not model-trusted) emit contract.

## References

- `v1/src/modes/plan/intent-split.ts:56-59` (the instruction); `v1/src/commands/intent.ts:252-270`
  (`validateIntentStage` hard-reject). Evidence: seeds 1 & 5 this session, 3 wasted opus intent runs.

## Prerequisites

none
