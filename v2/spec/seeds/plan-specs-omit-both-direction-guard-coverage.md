# Planned specs omit the guard coverage the mutation gate requires

## Problem

The plan step writes acceptance criteria that assert **the feature works**. The completion mutation
gate requires that **every changed guard is pinned in both directions**. Nothing in the plan step
bridges the two, so implement runs routinely satisfy every acceptance criterion, pass the ready gate,
pass CI, and then fail `surviving_mutation_failed` on a guard no criterion ever asked about.

Five of eight implement runs in one session (2026-07-21) stalled exactly this way:

| Spec | Surviving mutation | Guard the AC never mentioned |
| --- | --- | --- |
| `workflow-command-reports-terminal-workflow-failure` | `!== → ===` `run.ts:28` | new `run list` columns rendered but unasserted |
| `cleanup-archives-workflow-specs-in-one-run` | `=== → !==` `cleanup.ts:161` | unreachable `listRuns?.()` fallback |
| `runtime-smoke-records-discovery-outcomes` | `!== → ===` `write-loop.ts:215` | negative case: no outcome ⇒ no durable event |
| `dispatch-to-digest-keyed-daemon` | `guard-flip` `stale-dispatch.ts:28` | concurrent-start `DaemonAlreadyRunningError` race |
| `cleanup-non-interactive-confirm-flag` | `< → >=` `usage.ts:16` | verifier defect (see `mutation-verifier-flips-operators-inside-string-literals`) |

Four of the five were genuine coverage gaps; the gate was right every time. Each cost a full re-run
cycle, and each was recovered only by the operator hand-editing the spec to add the missing
criterion — the same edit, five times, phrased five ways.

The gap is structural, not agent error. An implementer who satisfies the written criteria has done
what was asked. The criteria are what is wrong.

## Decisions

- The plan step emits a standing acceptance criterion on every subspec whose change touches
  executable code: every guard the change adds or modifies is pinned in both directions, so
  inverting it fails a test. Rules out relying on the implementer to infer the gate's standard.
- Phrase it as one general criterion, not an enumeration of guards. The plan step cannot know which
  guards the implementation will introduce. Rules out asking the planner to predict line numbers.
- Include the negative case explicitly — absence-of-effect is the most commonly missed direction
  (three of the five above). Rules out wording that reads as "assert the happy path twice."
- Do not add this to specs that change only documentation or spec Markdown. Rules out noise on
  prose-only work, which has no guards.
- Do not weaken, bypass, or make advisory the mutation gate itself. Rules out "fixing" this by
  loosening the gate that has been correct in every observed case.

## Acceptance criteria

- [ ] A planned subspec whose scope includes executable code carries a both-direction guard-pinning
      acceptance criterion.
- [ ] A planned subspec limited to documentation or spec Markdown does not.
- [ ] The criterion names the negative direction (a guard that suppresses an effect must have a test
      proving the effect is absent), not only the positive.
- [ ] Regression coverage drives the plan step over a code-touching ready intent and a docs-only
      ready intent, asserting the criterion is present in the first and absent from the second.
- [ ] Existing plan-step behavior, spec structure, and criteria are otherwise unchanged.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — the plan step's standing guard-coverage criterion.
- `v1/docs/spec-guidance.md` — acceptance criteria must pin guards in both directions.
