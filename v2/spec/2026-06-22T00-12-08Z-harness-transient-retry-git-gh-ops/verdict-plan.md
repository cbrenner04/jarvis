# Verdict

This spec correctly reuses the shipped transient classifier and applies bounded retry at the harness's own git/gh ops. The direction is sound. The following refinements are required before it ships, because as drafted it could re-break its own motivating scenario and carries several untestable or imprecise contracts.

## Must fix — would let a broken fix ship

1. **`gh pr ready` idempotency on retry.** The motivating failure (TLS handshake timeout on `gh pr ready`) is exactly the case where the server may have flipped the PR but the ack was lost. The re-attempt then runs `gh pr ready` against an already-ready PR, which exits non-zero with a message that matches no transient pattern — so the run fast-fails on what was actually a success. There is no existing PR-state guard before the call. The spec must add a decision and an AC: a retry that encounters "already ready" / "not a draft" stderr is treated as success. Note that `git push`'s analogue is benign (re-push → "Everything up-to-date", exit 0), so this guard is `gh pr ready`-specific. This is the single most important refinement — without it the spec can re-break seed 3.

2. **Where retry sits relative to the injection seam (testability).** Each direct site resolves `fn = opts.injected ?? realFn`, and `pushCurrent` has no seam at all today. The spec must pin that retry wraps the real network op *below* the existing injection seam, and that tests drive transience through an exec/thunk seam the wrapper itself exposes (extend the already-promised injectable sleep + retry callback to cover the exec thunk). Without this, 01's ACs cannot be exercised: wrapping the real op leaves injected stubs un-retried, while wrapping the seam call silently changes existing test semantics. Applying retry to `pushCurrent` also requires defining its new seam — state that.

3. **"Shares no substring" is an unsatisfiable contract.** The agent line already contains `transient`, `retry`, `attempt`, `exit`, `error`; any reasonable harness retry line reuses some of these. Taken literally the AC forbids any sensible message. The real intent is *operator-distinguishable*: a distinct, op-scoped line not confusable with a hang or a quota fallback. Reword the decision and AC accordingly.

## Should fix — cheap correctness/clarity

4. **"Single shared unit" overclaims.** The async (00) and sync (01) retry loops cannot be one function. What is genuinely shared is the classifier, the cap/backoff constants, and the message builder — not the loop body. Restate as: shared policy (classifier + constants + message) with two thin loop implementations (async/sync) over it.

5. **No AC verifies the backoff seam fires.** Backoff is elevated to a load-bearing decision and the sleep seam is created for it, yet nothing asserts it runs. An implementation that skips backoff currently passes every AC. Add an AC: the sleep seam is invoked once per re-attempt (N−1 times across N attempts).

6. **Define `op` and align arg order.** Specify what `op` is and how it's derived for the multi-subcommand chokepoint (a short op label, e.g. the gh/git subcommand). Align `isTransientNetworkError`'s signature to the sibling classifier family's parameter order (exitCode before stderr) to avoid a foreseeable swap bug across the two call sites.

7. **Sync path exitCode for the guard.** `execFileSync` errors carry `.status` (null on signal). Pin what exitCode feeds the `exitCode === 0 → false` guard (a non-zero sentinel such as `.status ?? -1`) so a thrown error never accidentally reads as exit 0.

## Acknowledge — one line each, no new work

8. **`git fetch origin` exclusion is correct but unstated.** `bestEffortFetch` already swallows all failures and cannot kill a run, so it needs no retry; other git execFileSync sites are local. Add one out-of-scope line confirming the narrowing to `runGhCommand` + `pushCurrent` + direct `gh pr ready` is deliberate, not an oversight.

9. **01 depends on 00.** This ordered pair is fine, but per the "atomic, independently testable" convention 01 should explicitly note it depends on 00's shared classifier/policy.

10. **Offline/DNS is transient-then-bounded, not fast-fail.** `could not resolve host` is in the transient list, so a genuinely offline operator pays the full capped retry latency. The behavior is intended; the spec's "permanent failures fast-fail" framing should not imply offline fast-fails. One clarifying line.

11. **Ground the phrasing list in real strings.** Tie the new git/gh transient phrasings to the observed seed-3 stderr plus well-known git/gh wordings, rather than enumerating for thoroughness — guards against inventing precision on transients no path exercises.