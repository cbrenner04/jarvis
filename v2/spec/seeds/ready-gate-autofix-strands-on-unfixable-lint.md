---
name: ready-gate-autofix-strands-on-unfixable-lint
---

# Ready-gate autofix treats an unfixable lint finding as autofix failure, stranding the lane permanently

## Problem

`runBuiltInReadyGateAutofixBiome` (`v2/src/execution/write-loop.ts:3300-3330`) runs `bun biome check --write --unsafe <changed paths>` and converts **any** non-timeout non-zero exit into a `FixCommandError`:

```ts
} catch (err) {
  if (err instanceof AsyncSubprocessError && err.code === "ETIMEDOUT") {
    throw new FixCommandError(`${displayCmd} exceeded ${opts.timeoutMs}ms budget`);
  }
  const captured = […];
  throw new FixCommandError(captured ? `${displayCmd} failed:\n${captured}` : `${displayCmd} failed`);
}
```

`biome check --write --unsafe` exits non-zero when it finds a diagnostic it cannot fix. `noExcessiveCognitiveComplexity` and `noNonNullAssertion` are both non-autofixable (the runbook already records `noNonNullAssertion` as `fix: "none"`). So on any diff containing one, autofix **can never succeed** — it is not a transient failure, it is a fixed point.

Autofix failure settles retryable `completion_commit_failed`, and `jarvis run resume` re-enters the same autofix, which fails identically. The lane is permanently stranded with correct, complete, committed work and the documented recovery cannot clear it.

**The exact sibling of this bug is already fixed one file away.** `runCompletionFormat` (`v2/src/execution/completion-commit.ts:88-102`) runs the same tool for the completion commit and deliberately swallows this case, with a comment naming the failure mode:

```ts
// Best-effort, like the checkpoint format pass: `biome check --write` applies every safe fix, but a
// non-autofixable finding (cognitive-complexity, non-null assertion) exits non-zero. A durability
// commit is never gated by lint — the completion commit takes the autofixed tree as-is, and the
// ready gate + CI remain the lint enforcers (with bounded repair). This stops the recurring
// `completion_commit_failed`-on-lint strand that left correct, complete work uncommitted.
// A genuine timeout still throws above (a hang is not a lint result).
```

The reasoning transfers verbatim: autofix is a best-effort convenience before bounded repair, not a gate. The gate itself already enforces lint, and bounded repair already exists to fix what autofix cannot. Failing the whole finalization because the *optional* pre-pass could not fix everything inverts that design — and skips the very repair arm that was built to handle it.

## Evidence (2026-09-07)

Two of three concurrent implement lanes stranded on this in one session, both unrecoverable by `jarvis run resume`:

| Run | Branch | Unfixable findings |
| --- | --- | --- |
| `d0923511` | `20260906T161030Z-canonical-pipeline-execution-state-and-stage-claims` | `noExcessiveCognitiveComplexity` (39 > 24) in `daemon-terminal-settlement-guard.ts:141`; `noNonNullAssertion` ×2 in `pipeline-execution.test.ts:8037,8051` |
| `84b37ce8` | `20260906T160950Z-daemon-start-reclaims-leftover-socket` | `noExcessiveCognitiveComplexity` ×2 |

`d0923511`'s log shows the fixed point directly — the resume consumed no iterations and re-settled the identical error:

```json
{"seq":2,"loopOutcomeKind":"completion_commit_failed","iterationsConsumed":5,"resumable":true,…}
{"seq":4,"loopOutcomeKind":"completion_commit_failed","iterationsConsumed":0,"resumable":true,…}
```

Both worktrees were clean, with the work committed. The runbook's "Agent-written cognitive complexity: three enforcement boundaries" section claims boundary (2) commits "the tree as-is even when a non-autofixable finding (`noExcessiveCognitiveComplexity`, max 24; `noNonNullAssertion`) remains" — true of the completion commit, but the autofix pre-pass in front of the gate still fails closed on the same findings, so operators reading that section will not predict this strand.

## Decisions

- Built-in ready-gate autofix treats a non-autofixable lint finding as a successful best-effort pass and proceeds to the gate; rules out an optional pre-pass failing finalization for a condition bounded repair exists to handle.
- A genuine `ETIMEDOUT`, a spawn failure, or a missing command still fails; rules out swallowing a hang or an absent toolchain as "nothing to fix".
- Autofix outcome is recorded (findings it could not fix) so the subsequent gate failure is attributable; rules out a silent pass that makes a later red gate look unexplained.
- The two sibling paths share one policy for "tool exited non-zero but applied its safe fixes"; rules out fixing this file-by-file and regressing the mirror again.
- Scope is the built-in biome autofix path only, not a configured `fixCommand`, whose non-zero exit stays a real failure; rules out silently ignoring an operator-supplied command's error.

## Acceptance criteria

- [ ] A test proves `runBuiltInReadyGateAutofixBiome` returns normally when biome exits non-zero having applied its safe fixes with a non-autofixable finding remaining; it fails against the current unconditional `FixCommandError`.
- [ ] A test proves `ETIMEDOUT` still throws `FixCommandError` naming the budget.
- [ ] A test proves a spawn failure (missing command) still throws rather than being treated as a clean pass.
- [ ] A write-loop test proves a run whose changed paths contain an unfixable `noExcessiveCognitiveComplexity` finding reaches the ready gate and its bounded repair instead of settling `completion_commit_failed`; it fails today.
- [ ] A test pins that a configured `fixCommand` exiting non-zero still settles a failure.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — built-in autofix is best-effort on lint findings; only timeout and spawn failure fail it.
- `v2/docs/operator-runbook.md` § The ready gate and § Agent-written cognitive complexity — correct "Autofix failure settles retryable `completion_commit_failed`" to name only timeout/spawn failure, so the three-boundary section predicts this case.
