# Bounded transient retry inside the gh chokepoint

## Problem

`runGhCommand` (`v1/src/gh.ts`) is the async chokepoint for `gh auth status`,
`gh repo view` (`getBaseBranch`), `gh pr comment` (`postPrComment`), and
review-feedback gh calls. It returns `{stdout, stderr, exitCode}` and never
retries: a transient network error (TLS handshake timeout, DNS hiccup,
connection reset) surfaces as a non-zero result and the caller throws, killing
the run over a blip.

The agent-spawn path already solved the same problem with a classifier
(`isTransientSignal` / `sharedTransportPatterns` in `v1/src/agents/quota.ts`)
and a bounded re-attempt. Reuse it here. The classifier's current phrasings
(`connection reset`, `socket hang up`, `502/503/504/529`, …) do **not** cover
the git/gh-specific wordings that killed seed 3 — `TLS handshake timeout`,
`could not resolve host` (DNS), `operation timed out`, SSL errors, `the remote
end hung up` — so the transient surface must be widened for the harness path
without perturbing the shipped agent classifier.

## Decisions

- Reuse the shipped classifier; do not reimplement it. Add a name-agnostic
  export in `v1/src/agents/quota.ts` `isTransientNetworkError(exitCode,
  stderr)` — arg order matching the sibling classifier family (exitCode first)
  to avoid a swap bug across the two call sites — that matches
  `sharedTransportPatterns` ∪ a new harness-scoped git/gh phrasing list, with
  the same `exitCode === 0` → false guard. Rules out calling `isTransientSignal`
  with a fake `AgentName`, and rules out a parallel pattern list that duplicates
  `sharedTransportPatterns`.
- The new git/gh phrasings are grounded in the observed seed-3 stderr plus
  well-known git/gh wordings, not enumerated for thoroughness: `TLS handshake
  timeout` (seed 3), `could not resolve host` (git DNS failure), `operation
  timed out` / `timed out`, `SSL_ERROR` / handshake errors, `the remote end hung
  up unexpectedly` (git over HTTPS). They live in a **harness-scoped** list, not
  in the agent path's pattern lists. Rules out widening the shipped agent
  classifier's surface as a side effect (a separate, unmeasured behavior
  change), and rules out inventing precision on transients no path exercises.
- Bounded re-attempt cap mirrors the agent path: **2 re-attempts (3 total
  invocations)**, an internal constant. Rules out a divergent cap, an unbounded
  retry, and a configurable knob nobody has asked for.
- Add a bounded backoff between attempts (the agent path deliberately had none).
  Network transients — DNS, overload, TLS — benefit from a brief pause; the cap
  still guarantees termination. Schedule is an internal constant; the sleep is
  an injectable seam so tests do not wall-clock sleep. `Deferred to first
  consumer: making the cap or backoff configurable — pin when an operator hits a
  real endpoint that needs it`.
- Only a transient-classified non-zero result retries. Permanent gh failures —
  not-authenticated, 404, branch-protection `BLOCKED`, and the `ENOENT`
  binary-not-found `child.on("error")` path — match no transient pattern and
  fast-fail with exactly one invocation. Rules out retrying auth/permission
  errors that will never recover. (Offline / `could not resolve host` is
  transient by design: it pays the full capped retry before surfacing, not a
  fast-fail — the "permanent fast-fails" framing covers auth/404/`BLOCKED`, not
  network unreachability.)
- Each re-attempt is operator-distinguishable: a harness stderr line not
  confusable with a hang or a quota fallback, built by a new
  `harnessGitGhTransientRetryLine(op, attempt, cap)` in
  `v1/src/quota-harness-messages.ts`, op-scoped and visibly distinct from the
  quota strings (`quota exhausted; falling back` / `probable quota-like error`)
  and the agent transient line. Emitted via an injectable callback defaulting to
  a `process.stderr` write so tests can assert it. Rules out a silent retry
  indistinguishable from a hang. (`op` is a short op label — the gh/git
  subcommand, e.g. `gh pr comment`, `git push` — so the multi-subcommand
  chokepoint identifies which call is retrying.)
- The retry **policy** is shared with the sync git/gh ops in
  [01](./01-sync-git-gh-retry.md): one classifier (`isTransientNetworkError`),
  one set of cap/backoff constants, one message builder. The loop **bodies**
  differ (async re-await here, sync re-invoke in 01) and are two thin
  implementations over that shared policy — not one function. Rules out
  duplicated cap/backoff/pattern constants across the two paths.

## Task checklist

- Add `isTransientNetworkError(exitCode, stderr)` + the harness-scoped git/gh
  phrasing list to `v1/src/agents/quota.ts`; leave the agent classifier
  (`isTransientSignal`, `sharedTransportPatterns`) unchanged.
- Add `harnessGitGhTransientRetryLine(op, attempt, cap)` to
  `v1/src/quota-harness-messages.ts`.
- Wrap the spawn body of `runGhCommand` (`v1/src/gh.ts`) in a bounded retry:
  on a non-zero result that `isTransientNetworkError` matches, back off and
  re-invoke up to the cap; emit the harness line per re-attempt; return the
  eventual result (or the last one at the cap). Expose injectable sleep + retry
  callback seams for tests.
- Tests (`v1/test/agents/quota.test.ts`, `v1/test/gh.test.ts` or sibling):
  classifier truth table incl. the new git/gh phrasings, `exitCode === 0` →
  false, and permanent (`BLOCKED`/auth/404) not matched; `runGhCommand` retries
  a transient result to success; persistent transient returns the last result
  after exactly 3 invocations (bound, not external limit); permanent failure
  invokes exactly once; the injectable sleep seam fires once per re-attempt
  (N−1 across N attempts); the harness retry line fires per re-attempt and is
  op-scoped and distinct from the quota/agent strings.
- Docs: `v1/docs/quota-signals.md` (classifier now also guards the harness's own
  gh ops; new git/gh phrasings + bounded backoff), `v2/docs/v1-behaviors.md`
  (`runGhCommand` bounded-retries transient gh failures; permanent fast-fail).

## Acceptance criteria

- [ ] A transient-classified non-zero `gh` result (e.g. `TLS handshake timeout`,
  `could not resolve host`) from `runGhCommand` is re-invoked on the same call
  and, when a later attempt exits `0`, `runGhCommand` returns that success
  (test).
- [ ] A persistently transient `gh` failure terminates: after the fixed cap the
  call returns the last non-zero result; the test asserts exactly 3 invocations
  so the bound — not an external limit — is what stops it (test).
- [ ] A permanent `gh` failure (branch-protection `BLOCKED`, not-authenticated,
  or 404) is returned without retry — exactly one invocation (test).
- [ ] `isTransientNetworkError` returns false for `exitCode === 0`, matches the
  new git/gh phrasings, and the shipped agent classifier (`isTransientSignal`
  truth table in `v1/test/agents/quota.test.ts`) stays green — agent behavior
  unchanged (test).
- [ ] The injectable sleep seam is invoked once per re-attempt — N−1 times
  across N attempts — so backoff is exercised, not skipped (test).
- [ ] Each gh re-attempt emits `harnessGitGhTransientRetryLine`, an op-scoped
  line operator-distinguishable from the quota-fallback strings and the agent
  transient line (not confusable with a hang or a quota fallback) (test).
- [ ] `v1/docs/quota-signals.md` and `v2/docs/v1-behaviors.md` record the gh
  chokepoint retry, the reused classifier + new git/gh phrasings, the cap, the
  bounded backoff, and that permanent failures fast-fail.
- [ ] `bun run typecheck` and `bun run test` pass.
