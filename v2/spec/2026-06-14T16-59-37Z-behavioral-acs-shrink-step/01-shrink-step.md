# 01 - Post-completion shrink step

PR #203 shrank 25% (−561 lines) under one manual pass with zero functional
change; in-generation restraint loses to the agent's tick-the-criterion
objective. Add one dedicated turn that takes bloat *out* after the spec is done.
When the write loop reaches terminal `complete`, run one more `executeWrite`-shaped
step whose only instruction is a simplification checklist over the run's diff.
A shrink miss must never gate the already-complete, passing run: its changes are
reverted and the run completes on the pre-shrink code.

## Decisions

- Shrink runs once per run, only after the loop classifies terminal `complete`; never after `blocked`, `contract_miss`, `budget-exhausted`, or `invocation_failure` — rules out per-iteration shrink and shrinking incomplete runs.
- Shrink is an `executeWrite` step with shrink rules text and the same `artifact.exists` contract — rules out a bespoke step type and placement inside the review debate (mechanical verdict, nothing to adjudicate).
- Commit the terminal `complete` boundary before shrink runs; recovery returns completed runs idempotently and resets dirty worktree state to committed HEAD — rules out rerunning shrink as a normal write step after a crash.
- Discard-on-miss is scoped to in-process shrink misses by restoring to committed HEAD; either way the run stays `completed` and returns `complete` — rules out requiring a second durable pre-shrink ref.
- Inject the run-start commit into the shrink prompt and define scope as `base..HEAD` — rules out prose-only "run diff" boundaries the agent cannot inspect.
- Clean shrink success means terminal `complete` from `done` or `no-work`; `blocked` and `progress` are misses because shrink runs once — rules out retrying shrink iterations.
- Shrink's mechanical gate is suite re-run green plus no deleted test files in the shrink diff; AC non-regression remains prompt-only until a verification runner exists — rules out claiming `ready` enforces ACs or test retention.
- The loop reads registered `write.shrink` text and passes it as the step-rules string to a second write step — rules out hardcoding a second rules constant or adding step-type branching.
- Empty `base..HEAD` short-circuits shrink; otherwise shrink runs outside the iteration budget even when the terminal complete used the last normal iteration — rules out wasted no-diff invocations and budget-gated shrink.

## Task checklist

- [x] Add `prompts/write/shrink.md` (`write.shrink`): simplification checklist over `base..HEAD` only; forbid deleting tests or regressing ACs; name bloat patterns; no numeric/line-count target; narrow "no consumer" to "no consumer and no spec'd future consumer."
- [x] Wire the shrink step into `executeWriteLoop`: after a `complete` classification and non-empty `base..HEAD`, commit the complete boundary, run one shrink `executeWrite` with the `write.shrink` rules and run-start base ref, keep on clean success / restore to committed HEAD on miss, then return `complete`.
- [x] Add the mechanical gate: suite re-run green and shrink diff deletes no test files.
- [x] Cover routing, keep/discard, completed-run no-re-shrink, and crash-mid-shrink recovery through the test seam in `v2/src/write-loop.test.ts`.
- [x] Update docs.

## Acceptance criteria

- [x] After a write run reaches terminal `complete`, the loop performs exactly one additional write step carrying the shrink rules (not the normal step rules) before returning `complete`.
- [x] When a run ends `blocked`, `contract_miss`, `budget-exhausted`, or `invocation_failure`, no shrink step runs.
- [x] When the shrink step reaches a clean terminal success, its changes are kept and the run returns `complete`.
- [x] When the shrink step does not reach a clean terminal success, the worktree is restored to its pre-shrink state and the run still returns `complete` with the run's terminal kind and status unchanged.
- [x] Re-invoking a completed run performs no shrink step.
- [x] Crash-mid-shrink recovery returns to committed `complete`, resets dirty worktree state, and does not re-run shrink.
- [x] The `write.shrink` rules text scopes simplification to `base..HEAD`, forbids deleting tests or regressing acceptance criteria, names the bloat patterns to hunt, narrows unused machinery to "no consumer and no spec'd future consumer," and states no numeric or line-count target.
- [x] Shrink diff validation reruns the suite and rejects deleted test files; AC non-regression remains an explicit prompt-only residual risk.
- [x] `v2/docs/write-behavior.md` documents the shrink step in the loop lifecycle (post-`complete`, discard-on-miss, never gates).
- [x] `v2/docs/coding-standards.md` cross-links the shrink checklist to the restraint principles (same patterns, gate surface vs prevention surface).
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: the shrink step in the loop lifecycle.
- `v2/docs/coding-standards.md`: cross-link the shrink checklist to the restraint principles.
