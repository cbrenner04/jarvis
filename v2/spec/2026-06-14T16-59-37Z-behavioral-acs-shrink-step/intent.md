---
name: behavioral-acs-shrink-step
---

# Behavioral ACs + post-completion shrink step

PR #203 (write loop, ~2k lines) shrank 25% (−561 lines) under one manual review
pass with zero functional change. The bloat had three sources; the injected
restraint principles already target the middle one and didn't catch the rest.
Fix the other two ends: less bloat mandated *in* by specs, and a dedicated turn
to take the rest *out*. Prompt-only fixes have repeatedly failed here — during
generation, restraint loses to the agent's actual objective (tick the
criterion, emit the token).

## 1. Spec guidance: ACs describe observable behavior, not structure

Evidence: "migrations are forward-only and idempotent (test)" produced a
72-line migration ledger guarding three already-idempotent `CREATE TABLE IF NOT
EXISTS` statements; "no duplicate outcome row" produced a 1:1 `outcomes` table.
The criteria described structures, so the structures became mandatory. This is
the plan-loop precision-amplifier failure surfacing downstream at write time.

Amend spec guidance (`v1/docs/spec-guidance.md`, and wherever v2 plan-mode
rules land): acceptance criteria state observable behavior ("re-opening an
existing store is a no-op", "recovery cannot double-advance the checkpoint")
and stay silent on schema, tables, files, and shapes — unless the structure
*is* the contract (a public API, a wire format).

## 2. Shrink step: one extra write-loop iteration after spec completion

When the spec completes (terminal `done`/`no-work` with passing artifact
contract), before ready: run one more iteration whose only instruction is a
simplification checklist over the run's diff. Structurally it is another
`executeWrite` step with different rules text and the same terminal contract.

Placement decisions (made; not to be relitigated in plan):

- **Not in the review debate.** The debate roles resolve judgment; a shrink
  pass has a mechanical verdict (tests green, ACs intact, diff smaller or
  not) — nothing to adjudicate, so the adversarial cycles buy nothing.
- **Once per spec, not per iteration/patch.** Amortized over the iterations
  that produced the code, roughly one extra invocation per ~10.
- `no-work` is a fine outcome; the cost is one short invocation.

Guardrails:

- Scope is the run's diff only — files the spec's iterations didn't touch are
  off limits.
- Tests must pass and no acceptance criterion may regress; deleting a test to
  get smaller is a contract miss.
- Hunts patterns, not line counts (no numeric targets in the prompt): fields
  derivable from other inputs, pass-through wrappers, dead enum/status values,
  1:1 tables, repeated test input literals, docs restating signatures,
  machinery with no consumer yet (the ledger).

## Documentation updates (for the eventual spec)

- `v1/docs/spec-guidance.md`: the behavioral-AC rule.
- `v2/docs/write-behavior.md`: the shrink step in the loop lifecycle.
- `v2/docs/coding-standards.md`: cross-link the shrink checklist to the
  restraint principles (same patterns, gate surface vs prevention surface).

## Refinement

Commit ordering (supersedes the earlier "reverted, ready proceeds on pre-shrink
code" entry — same intent, now mechanically concrete):

- Commit the terminal `complete` boundary *before* shrink runs; shrink is a
  second `executeWrite` step over the committed-complete worktree. Rules out
  shrinking pre-commit, where a shrink crash would leave a complete spec with no
  durable boundary and re-run already-done iterations.
- Pre-shrink ref *is* the committed `complete` HEAD — no new durable ref. On
  in-process miss, reset the worktree to HEAD and proceed to ready on the
  complete code. Rules out the deferred separate snapshot ref: the commit
  already is the ref.
- Crash mid-shrink: the run is already committed `complete`; recovery returns
  `complete` idempotently and resets any dirty worktree to HEAD — shrink simply
  didn't happen, never re-runs as a normal write step. Rules out commit-after
  (re-runs shrink as an ordinary iteration over partially-reverted code).
- "Never gates ready" therefore holds because `complete` is committed before
  shrink, not because shrink changes are reverted; discard is scoped to
  in-process miss.

Verification contract (the review verdict is correct: `ready` cannot enforce
two of the three guardrails):

- Shrink's mechanical gate = suite re-runs green AND the shrink diff
  (`base..HEAD`, see below) deletes no test files. Pin both now. Do not name
  `ready` as enforcer — it runs the suite (a deleted test makes it *greener*)
  and never reads ACs.
- AC-non-regression stays prompt-only until a verification runner lands; accept
  the residual risk explicitly. Rules out claiming a mechanical AC gate that
  does not exist. Prompt-only risk is thus narrow and concentrated on this one
  guardrail — for the bulk of the diff, restraint and the shrink objective are
  aligned.

Scope base ref:

- Inject the run-start commit into the shrink prompt as the diff base; "the
  run's diff" is `base..HEAD`. Rules out leaving diff-base as prose — it is the
  central scope guardrail and must be machine-anchored.

Terminal classification:

- Keep-vs-discard keys on terminal `complete` (from `done`/`no-work`);
  `blocked`/`progress` = miss → discard. Constrain shrink rules text to emit
  only `done`/`no-work`. Step runs once, so `progress` cannot iterate.

Budget + empty diff:

- Shrink fires after terminal `complete`, outside the iteration budget; a run
  completing on its last allowed iteration still gets the shrink invocation.
- Empty/near-empty `base..HEAD` (e.g. `no-work` completion): short-circuit, skip
  shrink — no wasted invocation.

Loop mechanism (correct the architecture description):

- The loop reads the `write.shrink` prompt body and passes it as the step-rules
  string to a second write step — render-step prompt loading unchanged, no new
  loop responsibility, no step-type branching. Rules out hardcoding a second
  rules constant in the loop (the real alternative; there is no CLI
  `--step-rules` path).

Subspec scope adjustments for the draft:

- `00`: add the `v2/docs/v1-behaviors.md` entry — the new authoring rule changes
  observable `jarvis1 plan` output.
- `01`: narrow the "machinery with no consumer yet" pattern to "no consumer
  *and* no spec'd future consumer" so the checklist cannot delete
  intentionally staged-skeleton interfaces.
- `01` ACs: (a) re-invoking a `completed` run performs no shrink step;
  (b) crash-mid-shrink recovers to committed `complete` with worktree reset and
  no re-shrink; (c) the mandated `draft.md` revision bump.

