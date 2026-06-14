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
- Shrink rules text is a new registered prompt artifact (`write.shrink`), loaded by the loop — rules out threading shrink rules through the CLI `--step-rules` path used for the normal step.
- Discard-on-miss: if the shrink step does not reach a clean terminal success (terminal token + artifact contract intact), restore the worktree to its pre-shrink state; either way the run stays `completed` and the loop returns `complete` — rules out treating shrink as an ordinary iteration whose failed contract flips run status to blocked and aborts the run.
- The shrink step never creates a resumable boundary or alters run status/outcome kind; a run already `completed` resumes idempotently and does not re-shrink — rules out shrink reopening or re-running a committed run.
- Deferred to first consumer: a mechanical test/AC-verification contract beyond `artifact.exists` (run the project's tests, prove no AC regressed) — pin when a verification runner or `ready` is wired into the loop. Until then the tests-pass / no-AC-regress / no-test-deletion guardrails live in the shrink rules text and are enforced by `ready` on the kept diff.
- Deferred to first consumer: the worktree-snapshot/restore mechanism for discard — implementer default; pin when run history needs a durable pre-shrink ref.

## Task checklist

- [ ] Add `prompts/write/shrink.md` (`write.shrink`): simplification checklist over the run's diff only; forbid deleting tests or regressing ACs; name the bloat patterns; no numeric/line-count target.
- [ ] Wire the shrink step into `executeWriteLoop`: after a `complete` classification, snapshot the worktree, run one shrink `executeWrite` with the `write.shrink` rules, keep on clean success / restore on miss, then commit the terminal boundary and return `complete`.
- [ ] Cover routing through the test seam in `v2/src/write-loop.test.ts`.
- [ ] Update docs.

## Acceptance criteria

- [ ] After a write run reaches terminal `complete`, the loop performs exactly one additional write step carrying the shrink rules (not the normal step rules) before returning `complete`.
- [ ] When a run ends `blocked`, `contract_miss`, `budget-exhausted`, or `invocation_failure`, no shrink step runs.
- [ ] When the shrink step reaches a clean terminal success, its changes are kept and the run returns `complete`.
- [ ] When the shrink step does not reach a clean terminal success, the worktree is restored to its pre-shrink state and the run still returns `complete` with the run's terminal kind and status unchanged.
- [ ] The `write.shrink` rules text scopes simplification to the run's diff, forbids deleting tests or regressing acceptance criteria, names the bloat patterns to hunt, and states no numeric or line-count target.
- [ ] `v2/docs/write-behavior.md` documents the shrink step in the loop lifecycle (post-`complete`, discard-on-miss, never gates).
- [ ] `v2/docs/coding-standards.md` cross-links the shrink checklist to the restraint principles (same patterns, gate surface vs prevention surface).
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: the shrink step in the loop lifecycle.
- `v2/docs/coding-standards.md`: cross-link the shrink checklist to the restraint principles.
